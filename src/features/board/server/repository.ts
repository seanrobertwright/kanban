import { query, queryOne } from "@/shared/db/client";
import { requireBoardRole } from "@/features/workspaces/server/authz";
import type { Task } from "@/features/tasks/types";
import type { Board } from "@/features/workspaces/types";
import type { BoardData, Column } from "../types";

/**
 * Reads one board. The `board_id = $1` filters are what turn the old
 * "SELECT * FROM tasks" — which returned every task in the database — into a
 * tenant-scoped read. requireBoardRole has already proven the caller belongs to
 * the workspace that owns this board.
 */
export async function getBoard(
  userId: string,
  boardId: number
): Promise<BoardData | undefined> {
  await requireBoardRole(userId, boardId, "viewer");

  const board = await queryOne<Board>(
    `SELECT id, workspace_id AS "workspaceId", name, position,
            created_at AS "createdAt"
       FROM board WHERE id = $1`,
    [boardId]
  );
  if (!board) return undefined;

  const columns = await query<Column>(
    `SELECT id, board_id AS "boardId", title, position
       FROM board_column
      WHERE board_id = $1
      ORDER BY position, id`,
    [boardId]
  );

  const tasks = await query<Task>(
    `SELECT t.id, t.column_id AS "columnId", t.title, t.description, t.position,
            t.created_at AS "createdAt"
       FROM task t
       JOIN board_column bc ON bc.id = t.column_id
      WHERE bc.board_id = $1
      ORDER BY t.column_id, t.position`,
    [boardId]
  );

  return { board, columns, tasks };
}
