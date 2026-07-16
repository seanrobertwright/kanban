import type { PoolClient } from "pg";

import { withTransaction } from "@/shared/db/client";
import { logActivity } from "@/features/activity/server/repository";
import type { Actor, ColumnSnapshot } from "@/features/activity/types";
import {
  AuthzError,
  requireBoardRole,
  requireColumnRole,
} from "@/features/workspaces/server/authz";
import type { Column } from "../types";

/**
 * Columns stopped being seed data at this point (PRD §9). Agents move tasks
 * *between* states, so the states have to be the team's own — a board whose
 * three columns were chosen by us is a demo, and §6.2 scores it 1/limited for
 * exactly that reason.
 *
 * Gated by blast radius rather than by a single "may edit the board" rank, which
 * is the rule §7.4 sets for agent tools and is no less apt for people: creating
 * and renaming are cheap and reversible, so they take `member`; deleting can
 * destroy work, so it takes `admin`.
 */

const COLUMN_COLUMNS = `id, board_id AS "boardId", title, position`;

/** Every caller here is a signed-in person; agents become actors at M2. */
function human(userId: string): Actor {
  return { type: "human", id: userId };
}

function snapshot(column: Column): ColumnSnapshot {
  return {
    columnId: column.id,
    title: column.title,
    position: column.position,
  };
}

function selectColumn(client: PoolClient, id: number) {
  return client
    .query<Column>(`SELECT ${COLUMN_COLUMNS} FROM board_column WHERE id = $1`, [
      id,
    ])
    .then((r) => r.rows[0]);
}

/**
 * A column entry's `taskId` is null — the subject is the column, and no task
 * locates it. `boardId` is what makes the row findable at all, which is why 003
 * recorded it from the first row rather than leaving it to be backfilled through
 * tasks that may be gone.
 */
function columnEntry(
  workspaceId: string,
  boardId: number,
  userId: string
) {
  return { workspaceId, boardId, taskId: null, actor: human(userId) };
}

export async function createColumn(
  userId: string,
  boardId: number,
  title: string
): Promise<Column> {
  const { workspaceId } = await requireBoardRole(userId, boardId, "member");

  return withTransaction(async (client) => {
    const { rows } = await client.query<Column>(
      `INSERT INTO board_column (board_id, title, position)
       VALUES ($1, $2,
               (SELECT COALESCE(MAX(position) + 1, 0)
                  FROM board_column WHERE board_id = $1))
       RETURNING ${COLUMN_COLUMNS}`,
      [boardId, title]
    );
    const column = rows[0];

    await logActivity(client, {
      ...columnEntry(workspaceId, boardId, userId),
      action: "column.created",
      after: snapshot(column),
    });
    return column;
  });
}

export async function updateColumn(
  userId: string,
  id: number,
  title: string
): Promise<Column | undefined> {
  const { boardId, workspaceId } = await requireColumnRole(userId, id, "member");

  return withTransaction(async (client) => {
    const before = await selectColumn(client, id);
    if (!before) return undefined;

    // No-ops are not mutations — the rule the task and comment repositories both
    // follow. A rename to the same title is not a rename.
    if (before.title === title) return before;

    const { rows } = await client.query<Column>(
      `UPDATE board_column SET title = $2 WHERE id = $1
        RETURNING ${COLUMN_COLUMNS}`,
      [id, title]
    );
    const after = rows[0];

    await logActivity(client, {
      ...columnEntry(workspaceId, boardId, userId),
      action: "column.updated",
      before: snapshot(before),
      after: snapshot(after),
    });
    return after;
  });
}

/**
 * Reorders a column within its board, shifting its siblings to make room.
 *
 * The same integer-position dance moveTask does, and O(n) per move for the same
 * reason (§6.3.4). It matters even less here: a board has a handful of columns,
 * not thousands of tasks.
 */
export async function moveColumn(
  userId: string,
  id: number,
  position: number
): Promise<Column | undefined> {
  const { boardId, workspaceId } = await requireColumnRole(userId, id, "member");

  return withTransaction(async (client) => {
    const before = await selectColumn(client, id);
    if (!before) return undefined;

    // Close the gap this column leaves behind.
    await client.query(
      `UPDATE board_column SET position = position - 1
        WHERE board_id = $1 AND position > $2`,
      [boardId, before.position]
    );

    // Clamp to the end of the board. COUNT(*) is bigint, which pg hands back as
    // a string — ::int keeps the Math.min below doing arithmetic rather than
    // comparing strings.
    const { rows } = await client.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM board_column
        WHERE board_id = $1 AND id <> $2`,
      [boardId, id]
    );
    const target = Math.max(0, Math.min(position, rows[0].count));

    await client.query(
      `UPDATE board_column SET position = position + 1
        WHERE board_id = $1 AND position >= $2 AND id <> $3`,
      [boardId, target, id]
    );
    await client.query(`UPDATE board_column SET position = $2 WHERE id = $1`, [
      id,
      target,
    ]);

    const after = await selectColumn(client, id);
    if (!after || after.position === before.position) return after;

    // Only the moved column is logged, not the siblings that shifted around it —
    // those are consequences of this action, not actions anyone took. The same
    // call moveTask makes, for the same reason.
    await logActivity(client, {
      ...columnEntry(workspaceId, boardId, userId),
      action: "column.moved",
      before: snapshot(before),
      after: snapshot(after),
    });
    return after;
  });
}

/**
 * Deletes an empty column. Refuses a populated one.
 *
 * "conflict", not "forbidden" — an admin is allowed to attempt this, and the
 * refusal is an invariant rather than a permission. The same distinction
 * members.ts draws for the last owner, and it earns a 409 for the same reason.
 *
 * The check has to exist because the schema will not save us: task.column_id is
 * ON DELETE CASCADE, so the raw DELETE would take every task in the column with
 * it — silently, and without a single activity_log row to say what happened to
 * them. That CASCADE is right for what it is actually for (deleting a workspace
 * must take its boards, columns and tasks down), and wrong as the answer to a
 * button someone clicks. So the button never gets to fire it.
 *
 * FOR UPDATE is what makes the check an invariant rather than a suggestion.
 * Without it: we count zero tasks, another request inserts one, we delete, and
 * the CASCADE eats a task that was never in a column anyone deleted. The lock
 * closes that window, because inserting a task takes a FOR KEY SHARE lock on the
 * column row it references — so a concurrent createTask blocks here, then fails
 * on the foreign key once the column is gone, which is the honest outcome. An
 * invariant that a race can step around is not an invariant.
 */
export async function deleteColumn(userId: string, id: number): Promise<boolean> {
  const { boardId, workspaceId } = await requireColumnRole(userId, id, "admin");

  return withTransaction(async (client) => {
    const { rows: locked } = await client.query<Column>(
      `SELECT ${COLUMN_COLUMNS} FROM board_column WHERE id = $1 FOR UPDATE`,
      [id]
    );
    const before = locked[0];
    if (!before) return false;

    const { rows } = await client.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM task WHERE column_id = $1`,
      [id]
    );
    if (rows[0].count > 0) {
      throw new AuthzError(
        "conflict",
        `This column still holds ${rows[0].count} task(s). Move or delete them first.`
      );
    }

    await client.query(`DELETE FROM board_column WHERE id = $1`, [id]);
    await client.query(
      `UPDATE board_column SET position = position - 1
        WHERE board_id = $1 AND position > $2`,
      [boardId, before.position]
    );

    // `before` carries the title, and this is the row that needs it: the feed
    // resolves column names against the board, which no longer has this one.
    await logActivity(client, {
      ...columnEntry(workspaceId, boardId, userId),
      action: "column.deleted",
      before: snapshot(before),
    });
    return true;
  });
}
