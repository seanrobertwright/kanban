import { query, queryOne } from "@/shared/db/client";
import { AuthzError, requireBoardRole } from "@/features/workspaces/server/authz";
import type { Principal } from "@/features/auth/server/principal";
import type { Milestone } from "@/features/milestones/types";
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
  actor: string | Principal,
  boardId: number
): Promise<BoardData | undefined> {
  await requireBoardRole(actor, boardId, "viewer");

  const board = await queryOne<Board & { doneColumnId: number | null }>(
    `SELECT id, workspace_id AS "workspaceId", name, position,
            created_at AS "createdAt", done_column_id AS "doneColumnId"
       FROM board WHERE id = $1`,
    [boardId]
  );
  if (!board) return undefined;

  const columns = await query<Column>(
    `SELECT id, board_id AS "boardId", title, position,
            wip_limit AS "wipLimit"
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

  // The authz is done (requireBoardRole above), so listMilestones' own check
  // would be a second identical query — read the table directly.
  const milestones = await query<Milestone>(
    `SELECT m.id, m.board_id AS "boardId", m.name,
            m.due_date AS "dueDate", m.created_at AS "createdAt",
            (SELECT COUNT(*)::int FROM task t
              WHERE t.milestone_id = m.id AND t.parent_id IS NULL) AS total,
            (SELECT COUNT(*)::int FROM task t
              WHERE t.milestone_id = m.id AND t.parent_id IS NULL
                AND b2.done_column_id IS NOT NULL
                AND t.column_id = b2.done_column_id) AS done
       FROM milestone m
       JOIN board b2 ON b2.id = m.board_id
      WHERE m.board_id = $1
      ORDER BY m.due_date NULLS LAST, m.id`,
    [boardId]
  );

  return { board, columns, tasks, doneColumnId: board.doneColumnId, milestones };
}

/**
 * Designates (or clears, with null) the board's done column — the one a recurring
 * task spawns from when moved into it (020).
 *
 * "admin", the rank column deletion asks: which column means done is a structural
 * decision about the board, not per-task work, so it sits with the other
 * board-shape changes §7.4 gates behind admin.
 *
 * The column is proven to belong to *this* board, not merely to exist — "no such
 * column" and "a column of another board" collapse to one not_found, M0's rule,
 * so the id space cannot be probed. A FK alone would let one board point its done
 * marker at another board's column.
 */
export async function setBoardDoneColumn(
  actor: string | Principal,
  boardId: number,
  columnId: number | null
): Promise<void> {
  await requireBoardRole(actor, boardId, "admin");
  if (columnId !== null) {
    const column = await queryOne<{ id: number }>(
      `SELECT id FROM board_column WHERE id = $1 AND board_id = $2`,
      [columnId, boardId]
    );
    if (!column) {
      throw new AuthzError("not_found", "No such column on this board");
    }
  }
  await query(`UPDATE board SET done_column_id = $2 WHERE id = $1`, [
    boardId,
    columnId,
  ]);
}
