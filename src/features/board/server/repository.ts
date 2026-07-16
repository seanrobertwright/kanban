import { query, queryOne } from "@/shared/db/client";
import { requireBoardRole } from "@/features/workspaces/server/authz";
import { taskColumns } from "@/features/tasks/server/task-row";
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

  // taskColumns rather than a list written out here, which is what this query
  // used to have and how it came to return tasks with two fields missing: 006
  // added priority and due_date, the tasks repository knew, and this did not.
  // `query<Task>` cannot catch that — it is a cast, not a check — so the cards
  // rendered an undefined priority and no due date while every test passed.
  //
  // `parent_id IS NULL` is what makes the board a board rather than a list of
  // everything: 008's subtasks are whole tasks, so without this a parent and the
  // three pieces it was decomposed into arrive as four sibling cards. The pieces
  // are reached through their parent — the card carries a count, and the dialog
  // fetches them (listSubtasks).
  //
  // It is also the clause the drag maths depends on. Positions are scoped to
  // (column_id, parent_id), so filtering to parent_id IS NULL yields exactly one
  // sibling set per column, contiguous from 0 — which is the array the client
  // reorders and sends indexes into. See 008.
  const tasks = await query<Task>(
    `SELECT ${taskColumns("t")}
       FROM task t
       JOIN board_column bc ON bc.id = t.column_id
      WHERE bc.board_id = $1 AND t.parent_id IS NULL
      ORDER BY t.column_id, t.position`,
    [boardId]
  );

  return { board, columns, tasks };
}
