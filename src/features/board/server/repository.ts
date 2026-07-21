import { query, queryOne } from "@/shared/db/client";
import { AuthzError, requireBoardRole } from "@/features/workspaces/server/authz";
import type { Principal } from "@/features/auth/server/principal";
import type { CustomField } from "@/features/custom-fields/types";
import type { TaskDependencyEdge } from "@/features/dependencies/types";
import type { Milestone } from "@/features/milestones/types";
import type { Epic } from "@/features/epics/types";
import type { Sprint } from "@/features/sprints/types";
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

  // Epics ride along for the task dialog's picker and the EpicsDialog's first
  // paint, progress included — the milestone read's twin (031). An epic's rollup
  // spans its direct tasks and the tasks of its member milestones, so the count
  // predicate is the OR the epics repository documents. Authz already done above.
  const epics = await query<Epic>(
    `SELECT e.id, e.board_id AS "boardId", e.name,
            e.created_at AS "createdAt",
            (SELECT COUNT(*)::int FROM task t
              WHERE t.parent_id IS NULL
                AND (t.epic_id = e.id
                     OR t.milestone_id IN (SELECT id FROM milestone WHERE epic_id = e.id))) AS total,
            (SELECT COUNT(*)::int FROM task t
              WHERE t.parent_id IS NULL
                AND b2.done_column_id IS NOT NULL
                AND t.column_id = b2.done_column_id
                AND (t.epic_id = e.id
                     OR t.milestone_id IN (SELECT id FROM milestone WHERE epic_id = e.id))) AS done
       FROM epic e
       JOIN board b2 ON b2.id = e.board_id
      WHERE e.board_id = $1
      ORDER BY e.name, e.id`,
    [boardId]
  );

  // Sprints ride along for the task dialog's picker and the SprintsDialog's
  // first paint, progress included — the milestone read's twin, one migration
  // on. Authz already done above.
  const sprints = await query<Sprint>(
    `SELECT s.id, s.board_id AS "boardId", s.name, s.goal,
            s.start_date AS "startDate", s.end_date AS "endDate",
            s.status, s.created_at AS "createdAt",
            (SELECT COUNT(*)::int FROM task t
              WHERE t.sprint_id = s.id AND t.parent_id IS NULL) AS total,
            (SELECT COUNT(*)::int FROM task t
              WHERE t.sprint_id = s.id AND t.parent_id IS NULL
                AND b2.done_column_id IS NOT NULL
                AND t.column_id = b2.done_column_id) AS done,
            (SELECT COALESCE(SUM(t.estimate),0)::int FROM task t
              WHERE t.sprint_id = s.id AND t.parent_id IS NULL) AS points,
            (SELECT COALESCE(SUM(t.estimate),0)::int FROM task t
              WHERE t.sprint_id = s.id AND t.parent_id IS NULL
                AND b2.done_column_id IS NOT NULL
                AND t.column_id = b2.done_column_id) AS "donePoints"
       FROM sprint s
       JOIN board b2 ON b2.id = s.board_id
      WHERE s.board_id = $1
      ORDER BY array_position(ARRAY['active','planning','completed']::sprint_status[], s.status),
               s.start_date NULLS LAST, s.id DESC`,
    [boardId]
  );

  // Every blocked-by edge on this board (036), for the Gantt's arrows and
  // critical path. Both endpoints of an edge are always on the same board
  // (addDependency enforces it), so joining the dependent to its board is enough
  // to scope the set. Authz already done above — read the table directly, the
  // milestone read's shape. Subtask edges ride along; the Gantt keeps only the
  // ones whose both ends are top-level tasks it actually draws.
  const dependencies = await query<TaskDependencyEdge>(
    `SELECT d.task_id AS "taskId", d.depends_on_task_id AS "dependsOnId"
       FROM task_dependency d
       JOIN task t ON t.id = d.task_id
       JOIN board_column bc ON bc.id = t.column_id
      WHERE bc.board_id = $1`,
    [boardId]
  );

  // The board's custom-field definitions (035 → 036 follow-up), so a card and a
  // list cell can resolve a task's {fieldId, value} answers to a name and type.
  // Authz already done above — read the table directly, listBoardFields' query
  // without its second identical role check, the milestone read's shape.
  const customFields = await query<CustomField>(
    `SELECT id, board_id AS "boardId", name, type, options, position,
            created_at AS "createdAt"
       FROM custom_field
      WHERE board_id = $1
      ORDER BY position, id`,
    [boardId]
  );

  return {
    board,
    columns,
    tasks,
    doneColumnId: board.doneColumnId,
    milestones,
    epics,
    sprints,
    dependencies,
    customFields,
  };
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
