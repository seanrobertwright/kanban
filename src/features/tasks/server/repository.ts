import type { PoolClient } from "pg";

import { queryOne, withTransaction } from "@/shared/db/client";
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
  await requireColumnRole(userId, input.columnId, "member");
  const task = await queryOne<Task>(
    `INSERT INTO task (column_id, title, description, position)
     VALUES ($1, $2, $3,
             (SELECT COALESCE(MAX(position) + 1, 0) FROM task WHERE column_id = $1))
     RETURNING ${TASK_COLUMNS}`,
    [input.columnId, input.title, input.description ?? ""]
  );
  return task!;
}

export async function updateTask(
  userId: string,
  id: number,
  input: UpdateTaskInput
): Promise<Task | undefined> {
  await requireTaskRole(userId, id, "member");
  return queryOne<Task>(
    `UPDATE task
        SET title = COALESCE($2, title),
            description = COALESCE($3, description)
      WHERE id = $1
      RETURNING ${TASK_COLUMNS}`,
    [id, input.title ?? null, input.description ?? null]
  );
}

export async function moveTask(
  userId: string,
  id: number,
  input: MoveTaskInput
): Promise<Task | undefined> {
  const { boardId } = await requireTaskRole(userId, id, "member");
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
    const task = await selectTask(client, id);
    if (!task) return undefined;

    // Close the gap the task leaves behind in its source column.
    await client.query(
      "UPDATE task SET position = position - 1 WHERE column_id = $1 AND position > $2",
      [task.columnId, task.position]
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
    return selectTask(client, id);
  });
}

export async function deleteTask(userId: string, id: number): Promise<boolean> {
  await requireTaskRole(userId, id, "member");
  return withTransaction(async (client) => {
    const task = await selectTask(client, id);
    if (!task) return false;
    await client.query("DELETE FROM task WHERE id = $1", [id]);
    await client.query(
      "UPDATE task SET position = position - 1 WHERE column_id = $1 AND position > $2",
      [task.columnId, task.position]
    );
    return true;
  });
}
