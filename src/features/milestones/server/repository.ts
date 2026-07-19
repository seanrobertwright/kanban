import type { PoolClient } from "pg";

import { query, queryOne, withTransaction } from "@/shared/db/client";
import { logActivity } from "@/features/activity/server/repository";
import type { Actor, MilestoneSnapshot } from "@/features/activity/types";
import type { Principal } from "@/features/auth/server/principal";
import {
  AuthzError,
  requireBoardRole,
} from "@/features/workspaces/server/authz";
import type {
  CreateMilestoneInput,
  Milestone,
  UpdateMilestoneInput,
} from "../types";

/**
 * Milestones (026). The rank rules are the column rules, for the column
 * reasons: creating and editing are cheap and reversible (member), and even
 * deletion is member here — ON DELETE SET NULL un-aims tasks without taking
 * work with it, so there is no blast radius for admin to gate.
 */

const MILESTONE_COLUMNS = `m.id, m.board_id AS "boardId", m.name,
                           m.due_date AS "dueDate", m.created_at AS "createdAt"`;

/** total/done ride every read — the dialog's progress bar is the feature. */
const PROGRESS_COLUMNS = `
  (SELECT COUNT(*)::int FROM task t
    WHERE t.milestone_id = m.id AND t.parent_id IS NULL) AS total,
  (SELECT COUNT(*)::int FROM task t
     JOIN board b ON b.id = m.board_id
    WHERE t.milestone_id = m.id AND t.parent_id IS NULL
      AND b.done_column_id IS NOT NULL
      AND t.column_id = b.done_column_id) AS done`;

function snapshot(milestone: Milestone): MilestoneSnapshot {
  return {
    milestoneId: milestone.id,
    name: milestone.name,
    dueDate: milestone.dueDate,
  };
}

async function selectMilestone(
  client: PoolClient,
  id: number
): Promise<Milestone | undefined> {
  const { rows } = await client.query<Milestone>(
    `SELECT ${MILESTONE_COLUMNS}, ${PROGRESS_COLUMNS}
       FROM milestone m WHERE m.id = $1`,
    [id]
  );
  return rows[0];
}

export async function listMilestones(
  actor: string | Principal,
  boardId: number
): Promise<Milestone[]> {
  await requireBoardRole(actor, boardId, "viewer");
  return query<Milestone>(
    `SELECT ${MILESTONE_COLUMNS}, ${PROGRESS_COLUMNS}
       FROM milestone m
      WHERE m.board_id = $1
      ORDER BY m.due_date NULLS LAST, m.id`,
    [boardId]
  );
}

export async function createMilestone(
  userId: string,
  boardId: number,
  input: CreateMilestoneInput,
  by: Actor
): Promise<Milestone> {
  const { workspaceId } = await requireBoardRole(userId, boardId, "member");

  return withTransaction(async (client) => {
    const { rows } = await client.query<{ id: number }>(
      `INSERT INTO milestone (board_id, name, due_date)
       VALUES ($1, $2, $3) RETURNING id`,
      [boardId, input.name, input.dueDate ?? null]
    );
    const milestone = (await selectMilestone(client, rows[0].id))!;

    await logActivity(client, {
      workspaceId,
      boardId,
      taskId: null,
      actor: by,
      action: "milestone.created",
      after: snapshot(milestone),
    });
    return milestone;
  });
}

/** Resolves the milestone's own board — the one-join not_found rule. */
async function requireMilestone(
  userId: string,
  id: number
): Promise<{ boardId: number; workspaceId: string }> {
  const row = await queryOne<{ boardId: number }>(
    `SELECT board_id AS "boardId" FROM milestone WHERE id = $1`,
    [id]
  );
  if (!row) throw new AuthzError("not_found", "Milestone not found");
  const { workspaceId } = await requireBoardRole(userId, row.boardId, "member");
  return { boardId: row.boardId, workspaceId };
}

export async function updateMilestone(
  userId: string,
  id: number,
  input: UpdateMilestoneInput,
  by: Actor
): Promise<Milestone | undefined> {
  const { boardId, workspaceId } = await requireMilestone(userId, id);
  const setsDueDate = "dueDate" in input;

  return withTransaction(async (client) => {
    const before = await selectMilestone(client, id);
    if (!before) return undefined;
    if (
      (input.name === undefined || input.name === before.name) &&
      (!setsDueDate || (input.dueDate ?? null) === before.dueDate)
    )
      return before;

    await client.query(
      `UPDATE milestone
          SET name = COALESCE($2, name),
              due_date = CASE WHEN $3::boolean THEN $4::date ELSE due_date END
        WHERE id = $1`,
      [id, input.name ?? null, setsDueDate, input.dueDate ?? null]
    );
    const after = (await selectMilestone(client, id))!;

    await logActivity(client, {
      workspaceId,
      boardId,
      taskId: null,
      actor: by,
      action: "milestone.updated",
      before: snapshot(before),
      after: snapshot(after),
    });
    return after;
  });
}

/**
 * Deletion un-aims, never destroys: 026's SET NULL clears milestone_id on
 * every task that pointed here, which is why member suffices — the tasks and
 * their history are untouched, only the aim is gone.
 */
export async function deleteMilestone(
  userId: string,
  id: number,
  by: Actor
): Promise<boolean> {
  const { boardId, workspaceId } = await requireMilestone(userId, id);

  return withTransaction(async (client) => {
    const before = await selectMilestone(client, id);
    if (!before) return false;

    await client.query(`DELETE FROM milestone WHERE id = $1`, [id]);

    await logActivity(client, {
      workspaceId,
      boardId,
      taskId: null,
      actor: by,
      action: "milestone.deleted",
      before: snapshot(before),
    });
    return true;
  });
}
