import type { PoolClient } from "pg";

import { query, queryOne, withTransaction } from "@/shared/db/client";
import { logActivity } from "@/features/activity/server/repository";
import type { Actor, SprintSnapshot } from "@/features/activity/types";
import type { Principal } from "@/features/auth/server/principal";
import {
  AuthzError,
  requireBoardRole,
} from "@/features/workspaces/server/authz";
import type {
  CreateSprintInput,
  Sprint,
  SprintCapacityRow,
  UpdateSprintInput,
} from "../types";

/**
 * Sprints (028). The rank rules are the milestone rules for the milestone
 * reasons: create/edit/lifecycle are member-level board tuning, and even
 * deletion is member because ON DELETE SET NULL un-schedules tasks without
 * destroying them. The lifecycle transitions (start/complete) are the only
 * additions, and they are member too — starting a sprint is planning, not an
 * admin act.
 */

const SPRINT_COLUMNS = `s.id, s.board_id AS "boardId", s.name, s.goal,
                        s.start_date AS "startDate", s.end_date AS "endDate",
                        s.status, s.created_at AS "createdAt"`;

/**
 * total/done/points/donePoints, top-level tasks only (subtasks complete with
 * their parent). "done" is the board's done column (020); a board without one
 * has no notion of finished, so done/donePoints come back 0 rather than
 * claiming completion — blockedByOpenCount's honest zero. COALESCE(SUM,0)::int
 * because SUM over no rows is NULL and the type says number.
 */
const PROGRESS_COLUMNS = `
  (SELECT COUNT(*)::int FROM task t
    WHERE t.sprint_id = s.id AND t.parent_id IS NULL) AS total,
  (SELECT COUNT(*)::int FROM task t
     JOIN board b ON b.id = s.board_id
    WHERE t.sprint_id = s.id AND t.parent_id IS NULL
      AND b.done_column_id IS NOT NULL
      AND t.column_id = b.done_column_id) AS done,
  (SELECT COALESCE(SUM(t.estimate), 0)::int FROM task t
    WHERE t.sprint_id = s.id AND t.parent_id IS NULL) AS points,
  (SELECT COALESCE(SUM(t.estimate), 0)::int FROM task t
     JOIN board b ON b.id = s.board_id
    WHERE t.sprint_id = s.id AND t.parent_id IS NULL
      AND b.done_column_id IS NOT NULL
      AND t.column_id = b.done_column_id) AS "donePoints"`;

function snapshot(sprint: Sprint): SprintSnapshot {
  return { sprintId: sprint.id, name: sprint.name, status: sprint.status };
}

async function selectSprint(
  client: PoolClient,
  id: number
): Promise<Sprint | undefined> {
  const { rows } = await client.query<Sprint>(
    `SELECT ${SPRINT_COLUMNS}, ${PROGRESS_COLUMNS} FROM sprint s WHERE s.id = $1`,
    [id]
  );
  return rows[0];
}

export async function listSprints(
  actor: string | Principal,
  boardId: number
): Promise<Sprint[]> {
  await requireBoardRole(actor, boardId, "viewer");
  return query<Sprint>(
    // Active first, then planning, then completed; within a status, the newest
    // planning and the most-recently-finished sit near the top — the order a
    // board is scanned in.
    `SELECT ${SPRINT_COLUMNS}, ${PROGRESS_COLUMNS}
       FROM sprint s
      WHERE s.board_id = $1
      ORDER BY array_position(ARRAY['active','planning','completed']::sprint_status[], s.status),
               s.start_date NULLS LAST, s.id DESC`,
    [boardId]
  );
}

/**
 * The board's per-sprint, per-assignee load — the PRD payoff (§4.3): planning
 * that counts an agent's committed points beside a human's. One grouped query
 * over every sprint on the board rather than a subquery per sprint; the dialog
 * buckets the rows by sprintId. assignee null is the unassigned pile.
 */
export async function getBoardSprintCapacity(
  actor: string | Principal,
  boardId: number
): Promise<SprintCapacityRow[]> {
  await requireBoardRole(actor, boardId, "viewer");
  return query<SprintCapacityRow>(
    `SELECT t.sprint_id AS "sprintId",
            CASE WHEN t.assignee_id IS NOT NULL THEN 'human'
                 WHEN t.agent_id IS NOT NULL THEN 'agent'
                 ELSE NULL END AS "assigneeType",
            COALESCE(t.assignee_id, t.agent_id) AS "assigneeId",
            COUNT(*)::int AS count,
            COALESCE(SUM(t.estimate), 0)::int AS points
       FROM task t
       JOIN sprint s ON s.id = t.sprint_id
      WHERE s.board_id = $1 AND t.parent_id IS NULL
      GROUP BY 1, 2, 3
      ORDER BY points DESC`,
    [boardId]
  );
}

export async function createSprint(
  userId: string,
  boardId: number,
  input: CreateSprintInput,
  by: Actor
): Promise<Sprint> {
  const { workspaceId } = await requireBoardRole(userId, boardId, "member");

  return withTransaction(async (client) => {
    const { rows } = await client.query<{ id: number }>(
      `INSERT INTO sprint (board_id, name, goal, start_date, end_date)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [
        boardId,
        input.name,
        input.goal ?? "",
        input.startDate ?? null,
        input.endDate ?? null,
      ]
    );
    const sprint = (await selectSprint(client, rows[0].id))!;

    await logActivity(client, {
      workspaceId,
      boardId,
      taskId: null,
      actor: by,
      action: "sprint.created",
      after: snapshot(sprint),
    });
    return sprint;
  });
}

/** Resolves the sprint's own board — the one-join not_found rule. */
async function requireSprint(
  userId: string,
  id: number
): Promise<{ boardId: number; workspaceId: string }> {
  const row = await queryOne<{ boardId: number }>(
    `SELECT board_id AS "boardId" FROM sprint WHERE id = $1`,
    [id]
  );
  if (!row) throw new AuthzError("not_found", "Sprint not found");
  const { workspaceId } = await requireBoardRole(userId, row.boardId, "member");
  return { boardId: row.boardId, workspaceId };
}

export async function updateSprint(
  userId: string,
  id: number,
  input: UpdateSprintInput,
  by: Actor
): Promise<Sprint | undefined> {
  const { boardId, workspaceId } = await requireSprint(userId, id);
  const setsStart = "startDate" in input;
  const setsEnd = "endDate" in input;

  return withTransaction(async (client) => {
    const before = await selectSprint(client, id);
    if (!before) return undefined;

    await client.query(
      `UPDATE sprint
          SET name = COALESCE($2, name),
              goal = COALESCE($3, goal),
              start_date = CASE WHEN $4::boolean THEN $5::date ELSE start_date END,
              end_date = CASE WHEN $6::boolean THEN $7::date ELSE end_date END
        WHERE id = $1`,
      [id, input.name ?? null, input.goal ?? null, setsStart, input.startDate ?? null, setsEnd, input.endDate ?? null]
    );
    const after = (await selectSprint(client, id))!;

    await logActivity(client, {
      workspaceId,
      boardId,
      taskId: null,
      actor: by,
      action: "sprint.updated",
      before: snapshot(before),
      after: snapshot(after),
    });
    return after;
  });
}

/**
 * planning → active. The one-active-per-board invariant is enforced twice: a
 * clean 409 here for the ordinary case, and the partial unique index (028) as
 * the backstop against a race — two concurrent starts serialize on the index,
 * the loser's INSERT-shaped UPDATE failing rather than both winning. Defaults
 * start_date to today when unset, so burndown (a later slice) has a window
 * anchor. Only a planning sprint may start — restarting a completed one would
 * make velocity drift.
 */
export async function startSprint(
  userId: string,
  id: number,
  by: Actor
): Promise<Sprint | undefined> {
  const { boardId, workspaceId } = await requireSprint(userId, id);

  return withTransaction(async (client) => {
    const before = await selectSprint(client, id);
    if (!before) return undefined;
    if (before.status !== "planning") {
      throw new AuthzError(
        "conflict",
        "Only a planning sprint can be started"
      );
    }
    const { rows: active } = await client.query(
      `SELECT 1 FROM sprint WHERE board_id = $1 AND status = 'active'`,
      [boardId]
    );
    if (active.length > 0) {
      throw new AuthzError(
        "conflict",
        "This board already has an active sprint — complete it first"
      );
    }

    await client.query(
      `UPDATE sprint
          SET status = 'active',
              start_date = COALESCE(start_date, CURRENT_DATE)
        WHERE id = $1`,
      [id]
    );
    const after = (await selectSprint(client, id))!;

    await logActivity(client, {
      workspaceId,
      boardId,
      taskId: null,
      actor: by,
      action: "sprint.started",
      before: snapshot(before),
      after: snapshot(after),
    });
    return after;
  });
}

/**
 * active → completed, rolling incomplete tasks forward. "Incomplete" is
 * top-level tasks not in the board's done column; they move to
 * rolloverToSprintId (which the UI defaults to the earliest planning sprint) or
 * to the backlog (sprint_id NULL) when that is null or invalid. The rollover is
 * a bulk sprint_id update logged only by the sprint.completed event, not per
 * task — the milestone-delete precedent (a SET-NULL sweep is one event, not
 * N) — because the tasks' new home is visible on the board and velocity reads
 * the completed sprint's *frozen* scope, which completing is what freezes.
 *
 * end_date defaults to today when unset. A completed sprint is terminal.
 */
export async function completeSprint(
  userId: string,
  id: number,
  rolloverToSprintId: number | null,
  by: Actor
): Promise<Sprint | undefined> {
  const { boardId, workspaceId } = await requireSprint(userId, id);

  return withTransaction(async (client) => {
    const before = await selectSprint(client, id);
    if (!before) return undefined;
    if (before.status !== "active") {
      throw new AuthzError("conflict", "Only an active sprint can be completed");
    }

    // The rollover target must be a planning sprint on THIS board, else the
    // move is refused and the tasks fall to the backlog — a cross-board or
    // completed target is not a place unfinished work can go.
    let target: number | null = null;
    if (rolloverToSprintId != null) {
      const { rows } = await client.query(
        `SELECT 1 FROM sprint
          WHERE id = $1 AND board_id = $2 AND status = 'planning'`,
        [rolloverToSprintId, boardId]
      );
      if (rows.length > 0) target = rolloverToSprintId;
    }

    await client.query(
      `UPDATE task t
          SET sprint_id = $2
         FROM board b, board_column bc
        WHERE t.sprint_id = $1 AND t.parent_id IS NULL
          AND bc.id = t.column_id AND b.id = bc.board_id
          AND (b.done_column_id IS NULL OR t.column_id <> b.done_column_id)`,
      [id, target]
    );

    await client.query(
      `UPDATE sprint
          SET status = 'completed',
              end_date = COALESCE(end_date, CURRENT_DATE)
        WHERE id = $1`,
      [id]
    );
    const after = (await selectSprint(client, id))!;

    await logActivity(client, {
      workspaceId,
      boardId,
      taskId: null,
      actor: by,
      action: "sprint.completed",
      before: snapshot(before),
      after: snapshot(after),
    });
    return after;
  });
}

export async function deleteSprint(
  userId: string,
  id: number,
  by: Actor
): Promise<boolean> {
  const { boardId, workspaceId } = await requireSprint(userId, id);

  return withTransaction(async (client) => {
    const before = await selectSprint(client, id);
    if (!before) return false;

    await client.query(`DELETE FROM sprint WHERE id = $1`, [id]);

    await logActivity(client, {
      workspaceId,
      boardId,
      taskId: null,
      actor: by,
      action: "sprint.deleted",
      before: snapshot(before),
    });
    return true;
  });
}
