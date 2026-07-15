import type { PoolClient } from "pg";

import { queryOne, withTransaction } from "@/shared/db/client";
import { logActivity } from "@/features/activity/server/repository";
import type { Actor, TaskSnapshot } from "@/features/activity/types";
import {
  AuthzError,
  requireColumnRole,
  requireTaskRole,
} from "@/features/workspaces/server/authz";
import type {
  CreateTaskInput,
  MoveTaskInput,
  Task,
  UpdateTaskInput,
} from "../types";

// Postgres folds unquoted identifiers to lowercase, so `AS columnId` would
// arrive as `columnid`. The double quotes are load-bearing.
const TASK_COLUMNS = `id, column_id AS "columnId", title, description, position,
                      created_at AS "createdAt"`;

function selectTask(client: PoolClient, id: number) {
  return client
    .query<Task>(`SELECT ${TASK_COLUMNS} FROM task WHERE id = $1`, [id])
    .then((r) => r.rows[0]);
}

/** Every caller here is a signed-in person; agents become actors at M2. */
function human(userId: string): Actor {
  return { type: "human", id: userId };
}

function snapshot(task: Task): TaskSnapshot {
  return {
    title: task.title,
    description: task.description,
    columnId: task.columnId,
    position: task.position,
  };
}

/**
 * True when a write left the task exactly as it found it.
 *
 * The dialog PATCHes on close whether or not anything was edited, so without
 * this the history fills with entries whose before and after are identical.
 * That is not pedantry: a no-op is not a mutation, and at M2 undo replays these
 * rows — an inverse of "nothing changed" is a confusing no-op the user has to
 * reason about. Cheap to skip now, impossible to clean up later on an
 * append-only table.
 */
function unchanged(before: TaskSnapshot, after: TaskSnapshot): boolean {
  return (
    before.title === after.title &&
    before.description === after.description &&
    before.columnId === after.columnId &&
    before.position === after.position
  );
}

export async function getTask(
  userId: string,
  id: number
): Promise<Task | undefined> {
  await requireTaskRole(userId, id, "viewer");
  return queryOne<Task>(`SELECT ${TASK_COLUMNS} FROM task WHERE id = $1`, [id]);
}

export async function createTask(
  userId: string,
  input: CreateTaskInput
): Promise<Task> {
  const { boardId, workspaceId } = await requireColumnRole(
    userId,
    input.columnId,
    "member"
  );

  // Now a transaction: the insert and its log entry must land together, or a
  // crash between them leaves a task nobody can prove the creation of.
  return withTransaction(async (client) => {
    const { rows } = await client.query<Task>(
      `INSERT INTO task (column_id, title, description, position)
       VALUES ($1, $2, $3,
               (SELECT COALESCE(MAX(position) + 1, 0) FROM task WHERE column_id = $1))
       RETURNING ${TASK_COLUMNS}`,
      [input.columnId, input.title, input.description ?? ""]
    );
    const task = rows[0];

    await logActivity(client, {
      workspaceId,
      boardId,
      taskId: task.id,
      actor: human(userId),
      action: "task.created",
      // No `before`: the task did not exist. Undo inverts this to a delete.
      after: snapshot(task),
    });
    return task;
  });
}

export async function updateTask(
  userId: string,
  id: number,
  input: UpdateTaskInput
): Promise<Task | undefined> {
  const { boardId, workspaceId } = await requireTaskRole(userId, id, "member");

  return withTransaction(async (client) => {
    const before = await selectTask(client, id);
    if (!before) return undefined;

    const { rows } = await client.query<Task>(
      `UPDATE task
          SET title = COALESCE($2, title),
              description = COALESCE($3, description)
        WHERE id = $1
        RETURNING ${TASK_COLUMNS}`,
      [id, input.title ?? null, input.description ?? null]
    );
    const after = rows[0];

    if (!unchanged(snapshot(before), snapshot(after))) {
      await logActivity(client, {
        workspaceId,
        boardId,
        taskId: id,
        actor: human(userId),
        action: "task.updated",
        before: snapshot(before),
        after: snapshot(after),
      });
    }
    return after;
  });
}

export async function moveTask(
  userId: string,
  id: number,
  input: MoveTaskInput
): Promise<Task | undefined> {
  const { boardId, workspaceId } = await requireTaskRole(userId, id, "member");
  const target = await requireColumnRole(userId, input.columnId, "member");

  // Both checks above only prove the caller can touch each side. Without this
  // equality the API would happily move a task into a column of another board
  // the caller also belongs to — and, once workspaces are shared, across the
  // tenancy boundary itself.
  if (target.boardId !== boardId) {
    throw new AuthzError(
      "forbidden",
      "Cannot move a task to a column on a different board"
    );
  }

  return withTransaction(async (client) => {
    const before = await selectTask(client, id);
    if (!before) return undefined;

    // Close the gap the task leaves behind in its source column.
    await client.query(
      "UPDATE task SET position = position - 1 WHERE column_id = $1 AND position > $2",
      [before.columnId, before.position]
    );

    // Clamp the target position to the end of the destination column.
    // COUNT(*) is bigint, which pg returns as a *string* — ::int keeps the
    // Math.min below doing arithmetic rather than string comparison.
    const { rows } = await client.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM task WHERE column_id = $1 AND id <> $2`,
      [input.columnId, id]
    );
    const position = Math.max(0, Math.min(input.position, rows[0].count));

    // Make room at the target position.
    await client.query(
      `UPDATE task SET position = position + 1
        WHERE column_id = $1 AND position >= $2 AND id <> $3`,
      [input.columnId, position, id]
    );

    await client.query(
      "UPDATE task SET column_id = $1, position = $2 WHERE id = $3",
      [input.columnId, position, id]
    );
    const after = await selectTask(client, id);

    // Only the moved task is logged, not the siblings whose positions shifted
    // to accommodate it. Those are consequences of this action, not actions
    // anyone took — logging them would bury the real event under bookkeeping,
    // and undo replays the move, which reproduces the shifts anyway.
    if (after && !unchanged(snapshot(before), snapshot(after))) {
      await logActivity(client, {
        workspaceId,
        boardId,
        taskId: id,
        actor: human(userId),
        action: "task.moved",
        before: snapshot(before),
        after: snapshot(after),
      });
    }
    return after;
  });
}

export async function deleteTask(userId: string, id: number): Promise<boolean> {
  const { boardId, workspaceId } = await requireTaskRole(userId, id, "member");

  return withTransaction(async (client) => {
    const before = await selectTask(client, id);
    if (!before) return false;

    await client.query("DELETE FROM task WHERE id = $1", [id]);
    await client.query(
      "UPDATE task SET position = position - 1 WHERE column_id = $1 AND position > $2",
      [before.columnId, before.position]
    );

    // Logged after the DELETE, and it survives it: activity_log.task_id carries
    // no foreign key precisely so the record of a deletion outlives its subject.
    // `before` is the whole task, which is what undo needs to recreate it.
    await logActivity(client, {
      workspaceId,
      boardId,
      taskId: id,
      actor: human(userId),
      action: "task.deleted",
      before: snapshot(before),
    });
    return true;
  });
}
