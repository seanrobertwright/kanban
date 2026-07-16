import type { TaskSnapshot } from "@/features/activity/types";
import type { Task } from "../types";

/**
 * How a task is read and how it is remembered — the two things that must not
 * drift from the task's actual shape, kept in one file that owns neither
 * mutations nor the label vocabulary.
 *
 * Its own module rather than living in the tasks repository, because 007 made
 * that a cycle: the tasks repository calls into labels to set a task's labels,
 * and labels calls back to snapshot a task when deleting a vocabulary entry
 * unlabels it. Both need these two functions and neither should own them.
 */

/**
 * Every column of a task, optionally qualified by a table alias.
 *
 * A function rather than a constant because the constant it replaces could not
 * serve the queries that join — those need `t.id` where a plain read needs `id`,
 * so each of them hand-copied the list, and a hand-copied list drifts. It did:
 * 006 added priority and due_date here and getBoard kept selecting the seven
 * columns it already knew, returning tasks missing two fields while still being
 * typed as whole ones (fixed in 9edeff3).
 *
 * That bug is invisible to the compiler, which is the point of centralizing it.
 * `query<Task>` is a cast, not a check — pg cannot see the SQL, so a SELECT that
 * under-fetches type-checks perfectly and fails only in the browser, as an
 * undefined where a value should be. The one defence is that there be one list.
 *
 * Postgres folds unquoted identifiers to lowercase, so `AS columnId` would
 * arrive as `columnid`. The double quotes are load-bearing.
 *
 * due_date needs no cast or to_char: shared/db/client.ts parses DATE to the raw
 * 'YYYY-MM-DD' string globally, which is what keeps a due date from becoming a
 * JS Date at the one boundary where that silently changes the day.
 */
export function taskColumns(alias = ""): string {
  const p = alias ? `${alias}.` : "";
  // The subquery's reference to the outer row is qualified even when the rest of
  // the list is not — see labelsSubquery. `task.id` is in scope unaliased in a
  // plain SELECT and in an UPDATE's RETURNING, which are the only two places the
  // no-alias form is used.
  return `${p}id, ${p}column_id AS "columnId", ${p}title, ${p}description,
          ${p}position, ${p}assignee_id AS "assigneeId", ${p}priority,
          ${p}due_date AS "dueDate", ${p}created_at AS "createdAt",
          ${labelsSubquery(alias ? `${alias}.id` : "task.id")} AS labels`;
}

/**
 * A task's labels as a json array of {id, name}.
 *
 * Inside taskColumns rather than a join each caller remembers, which is the
 * whole lesson of 9edeff3: labels are the first thing to arrive on task after
 * that fix, and a read that forgot them would be typed as a whole Task and
 * render cards with no labels. A correlated subquery is the only shape that fits
 * a column list — a JOIN would multiply the task rows and push a GROUP BY into
 * every caller, which is exactly the per-caller knowledge that drifts.
 *
 * json_agg rather than array_agg: the value is a pair, and pg parses json for us
 * where an array of composite types would arrive as a string to be picked apart.
 *
 * COALESCE to '[]' because json_agg over no rows is NULL, not an empty array, and
 * `labels` is never null — the empty set is `[]`. That is not tidiness: `[]` is
 * what makes labelIds two-valued on update, and a null leaking through here would
 * put back the three-valued problem 006 avoided.
 *
 * ORDER BY inside the aggregate, so a task's labels come back in a stable order.
 * Without it Postgres may return them however it likes, and two reads of an
 * unchanged task could produce different arrays — which the no-op guard compares,
 * and would log as a change that never happened.
 *
 * The cost is one subquery per task row. A board reads a hundred tasks at most
 * and task_label's primary key leads with task_id, so each is an index lookup.
 * Worth revisiting when boards are paginated (M3), not before.
 *
 * `taskRef` must be qualified — `task.id` or `t.id`, never a bare `id` — and
 * this is not defensive, it is the bug this function shipped with for ten
 * minutes. Postgres resolves an unqualified name against the innermost scope
 * first, and the innermost scope here joins `label`, which has an `id`. So
 * `WHERE tl.task_id = id` compiles, runs, and quietly asks whether a task_id
 * equals a *label* id — returning the wrong set rather than an error, because
 * both are integers. The correlation to the outer row only exists if it is
 * spelled out.
 */
function labelsSubquery(taskRef: string): string {
  return `COALESCE((SELECT json_agg(json_build_object('id', l.id, 'name', l.name)
                                    ORDER BY l.id)
                      FROM task_label tl
                      JOIN label l ON l.id = tl.label_id
                     WHERE tl.task_id = ${taskRef}), '[]'::json)`;
}

/**
 * What a task looked like at one instant.
 *
 * Every field, on every action — `action` names what the entry is *about* while
 * the snapshot says what the whole task was on either side. Undo replays an
 * inverse mutation from this, so a field missing here is a field undo silently
 * fails to restore.
 */
export function taskSnapshot(task: Task): TaskSnapshot {
  return {
    title: task.title,
    description: task.description,
    columnId: task.columnId,
    position: task.position,
    assigneeId: task.assigneeId,
    priority: task.priority,
    dueDate: task.dueDate,
    labels: task.labels,
  };
}
