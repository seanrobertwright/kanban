import type { PoolClient } from "pg";

import { query, queryOne, withTransaction } from "@/shared/db/client";
import { logActivity } from "@/features/activity/server/repository";
import type { Actor, ObjectiveSnapshot } from "@/features/activity/types";
import type { Principal } from "@/features/auth/server/principal";
import {
  AuthzError,
  requireBoardRole,
} from "@/features/workspaces/server/authz";
import {
  keyResultProgress,
  objectiveProgress,
  type CreateKeyResultInput,
  type CreateObjectiveInput,
  type KeyResult,
  type Objective,
  type UpdateKeyResultInput,
  type UpdateObjectiveInput,
} from "../types";

/**
 * Objectives / OKRs (037). The rank rules are epic's, for epic's reasons: create
 * and edit are cheap and reversible (member), and even deletion is member — the
 * two SET NULL FKs un-aim an objective's tasks and milestones without taking
 * work with them, and a key result CASCADEs (it has no life apart from its
 * objective), so there is no blast radius for admin to gate.
 *
 * Objective lifecycle is logged (created/updated/deleted); key-result edits are
 * not — a KR's current value is nudged often and read live, so the feed tracks
 * the objective, not every measurement. See ObjectiveAction (037).
 */

const OBJECTIVE_COLUMNS = `o.id, o.board_id AS "boardId", o.name,
                           o.description, o.due_date AS "dueDate",
                           o.created_at AS "createdAt"`;

/**
 * Work rollup (031's epic shape): top-level tasks aiming at the objective —
 * directly (task.objective_id) or through a member milestone — and how many sit
 * in the board's done column. A task counted through both paths is one task (the
 * OR yields it once), so no DISTINCT. done stays 0 on a board with no done column.
 */
const ROLLUP_COLUMNS = `
  (SELECT COUNT(*)::int FROM task t
    WHERE t.parent_id IS NULL
      AND (t.objective_id = o.id
           OR t.milestone_id IN (SELECT id FROM milestone WHERE objective_id = o.id))) AS total,
  (SELECT COUNT(*)::int FROM task t
     JOIN board b ON b.id = o.board_id
    WHERE t.parent_id IS NULL
      AND b.done_column_id IS NOT NULL
      AND t.column_id = b.done_column_id
      AND (t.objective_id = o.id
           OR t.milestone_id IN (SELECT id FROM milestone WHERE objective_id = o.id))) AS done`;

const KEY_RESULT_COLUMNS = `id, objective_id AS "objectiveId", title,
   start_value AS "startValue", target_value AS "targetValue",
   current_value AS "currentValue", unit, position,
   created_at AS "createdAt"`;

/** The raw KR row before progress is derived onto it. */
type KeyResultRow = Omit<KeyResult, "progress">;

/** Derives each KR's progress and the objective's mean, folding the raw rows in.
 *  The one place progress is computed, so list and single reads agree. */
function withProgress(
  base: Omit<Objective, "keyResults" | "progress">,
  rows: KeyResultRow[]
): Objective {
  const keyResults: KeyResult[] = rows.map((kr) => ({
    ...kr,
    progress: keyResultProgress(kr),
  }));
  return { ...base, keyResults, progress: objectiveProgress(keyResults) };
}

async function selectObjective(
  client: PoolClient,
  id: number
): Promise<Objective | undefined> {
  const { rows } = await client.query<Omit<Objective, "keyResults" | "progress">>(
    `SELECT ${OBJECTIVE_COLUMNS}, ${ROLLUP_COLUMNS} FROM objective o WHERE o.id = $1`,
    [id]
  );
  if (!rows[0]) return undefined;
  const { rows: krs } = await client.query<KeyResultRow>(
    `SELECT ${KEY_RESULT_COLUMNS} FROM key_result
      WHERE objective_id = $1 ORDER BY position, id`,
    [id]
  );
  return withProgress(rows[0], krs);
}

export async function listObjectives(
  actor: string | Principal,
  boardId: number
): Promise<Objective[]> {
  await requireBoardRole(actor, boardId, "viewer");
  // Two reads, not N+1: every objective, then every key result across them,
  // grouped in memory. Ordered by due date (soonest first, undated last), then
  // name — the order an OKR list is reviewed in.
  const objectives = await query<Omit<Objective, "keyResults" | "progress">>(
    `SELECT ${OBJECTIVE_COLUMNS}, ${ROLLUP_COLUMNS}
       FROM objective o
      WHERE o.board_id = $1
      ORDER BY o.due_date NULLS LAST, o.name, o.id`,
    [boardId]
  );
  if (objectives.length === 0) return [];

  const krs = await query<KeyResultRow>(
    `SELECT ${KEY_RESULT_COLUMNS} FROM key_result
      WHERE objective_id = ANY($1) ORDER BY position, id`,
    [objectives.map((o) => o.id)]
  );
  const byObjective = new Map<number, KeyResultRow[]>();
  for (const kr of krs) {
    const list = byObjective.get(kr.objectiveId) ?? [];
    list.push(kr);
    byObjective.set(kr.objectiveId, list);
  }
  return objectives.map((o) => withProgress(o, byObjective.get(o.id) ?? []));
}

function snapshot(objective: Objective): ObjectiveSnapshot {
  return { objectiveId: objective.id, name: objective.name };
}

export async function createObjective(
  userId: string,
  boardId: number,
  input: CreateObjectiveInput,
  by: Actor
): Promise<Objective> {
  const { workspaceId } = await requireBoardRole(userId, boardId, "member");

  return withTransaction(async (client) => {
    const { rows } = await client.query<{ id: number }>(
      `INSERT INTO objective (board_id, name, description, due_date)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [boardId, input.name.trim(), input.description?.trim() ?? "", input.dueDate ?? null]
    );
    const objective = (await selectObjective(client, rows[0].id))!;

    await logActivity(client, {
      workspaceId,
      boardId,
      taskId: null,
      actor: by,
      action: "objective.created",
      after: snapshot(objective),
    });
    return objective;
  });
}

/**
 * Enforces the invariant 037 states but a bare FK cannot: a task or a milestone
 * aims only at an objective of its *own board*. assertEpicOnBoard's cross-tenant
 * guard, one table over — "not_found" for the same anti-enumeration reason.
 * Exported because both the tasks repository and the milestones repository aim
 * work at an objective.
 */
export async function assertObjectiveOnBoard(
  client: PoolClient,
  boardId: number,
  objectiveId: number
): Promise<void> {
  const { rows } = await client.query(
    `SELECT 1 FROM objective WHERE id = $1 AND board_id = $2`,
    [objectiveId, boardId]
  );
  if (rows.length === 0) {
    throw new AuthzError("not_found", "That objective is not on this board");
  }
}

/** Resolves the objective's own board — the one-join not_found rule. */
async function requireObjective(
  userId: string,
  id: number
): Promise<{ boardId: number; workspaceId: string }> {
  const row = await queryOne<{ boardId: number }>(
    `SELECT board_id AS "boardId" FROM objective WHERE id = $1`,
    [id]
  );
  if (!row) throw new AuthzError("not_found", "Objective not found");
  const { workspaceId } = await requireBoardRole(userId, row.boardId, "member");
  return { boardId: row.boardId, workspaceId };
}

export async function updateObjective(
  userId: string,
  id: number,
  input: UpdateObjectiveInput,
  by: Actor
): Promise<Objective | undefined> {
  const { boardId, workspaceId } = await requireObjective(userId, id);

  return withTransaction(async (client) => {
    const before = await selectObjective(client, id);
    if (!before) return undefined;

    // dueDate is three-valued: absent leaves it, null clears, a date sets it.
    const setsDue = "dueDate" in input;
    await client.query(
      `UPDATE objective
          SET name = COALESCE($2, name),
              description = COALESCE($3, description),
              due_date = CASE WHEN $4::boolean THEN $5::date ELSE due_date END
        WHERE id = $1`,
      [
        id,
        input.name?.trim() ?? null,
        input.description?.trim() ?? null,
        setsDue,
        input.dueDate ?? null,
      ]
    );
    const after = (await selectObjective(client, id))!;

    await logActivity(client, {
      workspaceId,
      boardId,
      taskId: null,
      actor: by,
      action: "objective.updated",
      before: snapshot(before),
      after: snapshot(after),
    });
    return after;
  });
}

/**
 * Deletion un-aims, never destroys: 037's two SET NULL FKs clear objective_id on
 * every task and milestone that pointed here (member suffices, epic's reason),
 * while the objective's own key results CASCADE away with it — they had no life
 * apart from it.
 */
export async function deleteObjective(
  userId: string,
  id: number,
  by: Actor
): Promise<boolean> {
  const { boardId, workspaceId } = await requireObjective(userId, id);

  return withTransaction(async (client) => {
    const before = await selectObjective(client, id);
    if (!before) return false;

    await client.query(`DELETE FROM objective WHERE id = $1`, [id]);

    await logActivity(client, {
      workspaceId,
      boardId,
      taskId: null,
      actor: by,
      action: "objective.deleted",
      before: snapshot(before),
    });
    return true;
  });
}

/** Resolves a key result's objective and the caller's standing on its board.
 *  Member — editing a measure is editing the objective's data. */
async function requireKeyResult(
  userId: string,
  keyResultId: number
): Promise<{ objectiveId: number }> {
  const row = await queryOne<{ objectiveId: number; boardId: number }>(
    `SELECT kr.objective_id AS "objectiveId", o.board_id AS "boardId"
       FROM key_result kr JOIN objective o ON o.id = kr.objective_id
      WHERE kr.id = $1`,
    [keyResultId]
  );
  if (!row) throw new AuthzError("not_found", "Key result not found");
  await requireBoardRole(userId, row.boardId, "member");
  return { objectiveId: row.objectiveId };
}

/**
 * Adds a key result and returns its objective, refreshed — the dialog re-renders
 * the whole objective (KR list + rolled-up progress) from one response. current
 * defaults to start ("start where it starts"), start to 0.
 */
export async function createKeyResult(
  userId: string,
  objectiveId: number,
  input: CreateKeyResultInput
): Promise<Objective> {
  await requireObjective(userId, objectiveId);
  const start = input.startValue ?? 0;
  const current = input.currentValue ?? start;

  return withTransaction(async (client) => {
    await client.query(
      `INSERT INTO key_result
         (objective_id, title, start_value, target_value, current_value, unit, position)
       VALUES ($1, $2, $3, $4, $5, $6,
               (SELECT COALESCE(MAX(position) + 1, 0)
                  FROM key_result WHERE objective_id = $1))`,
      [objectiveId, input.title.trim(), start, input.targetValue, current, input.unit?.trim() ?? ""]
    );
    return (await selectObjective(client, objectiveId))!;
  });
}

export async function updateKeyResult(
  userId: string,
  id: number,
  input: UpdateKeyResultInput
): Promise<Objective> {
  const { objectiveId } = await requireKeyResult(userId, id);

  return withTransaction(async (client) => {
    await client.query(
      `UPDATE key_result
          SET title = COALESCE($2, title),
              start_value = COALESCE($3, start_value),
              target_value = COALESCE($4, target_value),
              current_value = COALESCE($5, current_value),
              unit = COALESCE($6, unit),
              position = COALESCE($7, position)
        WHERE id = $1`,
      [
        id,
        input.title?.trim() ?? null,
        input.startValue ?? null,
        input.targetValue ?? null,
        input.currentValue ?? null,
        input.unit?.trim() ?? null,
        input.position ?? null,
      ]
    );
    return (await selectObjective(client, objectiveId))!;
  });
}

export async function deleteKeyResult(
  userId: string,
  id: number
): Promise<Objective> {
  const { objectiveId } = await requireKeyResult(userId, id);
  await query(`DELETE FROM key_result WHERE id = $1`, [id]);
  return (await withTransaction((client) => selectObjective(client, objectiveId)))!;
}
