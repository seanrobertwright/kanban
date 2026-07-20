import type { PoolClient } from "pg";

import { query, queryOne, withTransaction } from "@/shared/db/client";
import { logActivity } from "@/features/activity/server/repository";
import type { Actor, EpicSnapshot } from "@/features/activity/types";
import type { Principal } from "@/features/auth/server/principal";
import {
  AuthzError,
  requireBoardRole,
} from "@/features/workspaces/server/authz";
import type { CreateEpicInput, Epic, UpdateEpicInput } from "../types";

/**
 * Epics (031). The rank rules are milestone's, for milestone's reasons: create
 * and edit are cheap and reversible (member), and even deletion is member —
 * ON DELETE SET NULL un-files an epic's tasks and milestones without taking work
 * with it, so there is no blast radius for admin to gate.
 */

const EPIC_COLUMNS = `e.id, e.board_id AS "boardId", e.name,
                      e.created_at AS "createdAt"`;

/**
 * total/done ride every read — the dialog's progress bar is the feature. An
 * epic's tasks are the union of two sets: tasks filed on the epic directly, and
 * tasks whose milestone is filed under the epic (031's "above the milestone"
 * rollup). A task counted through both paths is still one task — the OR yields it
 * once — so no DISTINCT is needed.
 */
const PROGRESS_COLUMNS = `
  (SELECT COUNT(*)::int FROM task t
    WHERE t.parent_id IS NULL
      AND (t.epic_id = e.id
           OR t.milestone_id IN (SELECT id FROM milestone WHERE epic_id = e.id))) AS total,
  (SELECT COUNT(*)::int FROM task t
     JOIN board b ON b.id = e.board_id
    WHERE t.parent_id IS NULL
      AND b.done_column_id IS NOT NULL
      AND t.column_id = b.done_column_id
      AND (t.epic_id = e.id
           OR t.milestone_id IN (SELECT id FROM milestone WHERE epic_id = e.id))) AS done`;

function snapshot(epic: Epic): EpicSnapshot {
  return { epicId: epic.id, name: epic.name };
}

async function selectEpic(
  client: PoolClient,
  id: number
): Promise<Epic | undefined> {
  const { rows } = await client.query<Epic>(
    `SELECT ${EPIC_COLUMNS}, ${PROGRESS_COLUMNS}
       FROM epic e WHERE e.id = $1`,
    [id]
  );
  return rows[0];
}

export async function listEpics(
  actor: string | Principal,
  boardId: number
): Promise<Epic[]> {
  await requireBoardRole(actor, boardId, "viewer");
  // By name, not by date: an epic has no due date to order on, and a stable
  // alphabetical list is the scannable one. id breaks ties.
  return query<Epic>(
    `SELECT ${EPIC_COLUMNS}, ${PROGRESS_COLUMNS}
       FROM epic e
      WHERE e.board_id = $1
      ORDER BY e.name, e.id`,
    [boardId]
  );
}

export async function createEpic(
  userId: string,
  boardId: number,
  input: CreateEpicInput,
  by: Actor
): Promise<Epic> {
  const { workspaceId } = await requireBoardRole(userId, boardId, "member");

  return withTransaction(async (client) => {
    const { rows } = await client.query<{ id: number }>(
      `INSERT INTO epic (board_id, name) VALUES ($1, $2) RETURNING id`,
      [boardId, input.name]
    );
    const epic = (await selectEpic(client, rows[0].id))!;

    await logActivity(client, {
      workspaceId,
      boardId,
      taskId: null,
      actor: by,
      action: "epic.created",
      after: snapshot(epic),
    });
    return epic;
  });
}

/**
 * Enforces the invariant 031 states but a bare foreign key cannot: a task or a
 * milestone is filed only under an epic of its *own board*. The FK proves the
 * epic exists somewhere; without this, any epic id in the database could be
 * written onto any task — assertMilestoneOnBoard's cross-tenant reference, one
 * table over. "not_found" for the same anti-enumeration reason. Exported because
 * both the tasks repository and the milestones repository file against an epic.
 */
export async function assertEpicOnBoard(
  client: PoolClient,
  boardId: number,
  epicId: number
): Promise<void> {
  const { rows } = await client.query(
    `SELECT 1 FROM epic WHERE id = $1 AND board_id = $2`,
    [epicId, boardId]
  );
  if (rows.length === 0) {
    throw new AuthzError("not_found", "That epic is not on this board");
  }
}

/** Resolves the epic's own board — the one-join not_found rule. */
async function requireEpic(
  userId: string,
  id: number
): Promise<{ boardId: number; workspaceId: string }> {
  const row = await queryOne<{ boardId: number }>(
    `SELECT board_id AS "boardId" FROM epic WHERE id = $1`,
    [id]
  );
  if (!row) throw new AuthzError("not_found", "Epic not found");
  const { workspaceId } = await requireBoardRole(userId, row.boardId, "member");
  return { boardId: row.boardId, workspaceId };
}

export async function updateEpic(
  userId: string,
  id: number,
  input: UpdateEpicInput,
  by: Actor
): Promise<Epic | undefined> {
  const { boardId, workspaceId } = await requireEpic(userId, id);

  return withTransaction(async (client) => {
    const before = await selectEpic(client, id);
    if (!before) return undefined;
    if (input.name === undefined || input.name === before.name) return before;

    await client.query(`UPDATE epic SET name = $2 WHERE id = $1`, [
      id,
      input.name,
    ]);
    const after = (await selectEpic(client, id))!;

    await logActivity(client, {
      workspaceId,
      boardId,
      taskId: null,
      actor: by,
      action: "epic.updated",
      before: snapshot(before),
      after: snapshot(after),
    });
    return after;
  });
}

/**
 * Deletion un-files, never destroys: 031's two SET NULL FKs clear epic_id on
 * every task and every milestone that pointed here, which is why member suffices
 * — the work and its history are untouched, only the grouping is gone.
 */
export async function deleteEpic(
  userId: string,
  id: number,
  by: Actor
): Promise<boolean> {
  const { boardId, workspaceId } = await requireEpic(userId, id);

  return withTransaction(async (client) => {
    const before = await selectEpic(client, id);
    if (!before) return false;

    await client.query(`DELETE FROM epic WHERE id = $1`, [id]);

    await logActivity(client, {
      workspaceId,
      boardId,
      taskId: null,
      actor: by,
      action: "epic.deleted",
      before: snapshot(before),
    });
    return true;
  });
}
