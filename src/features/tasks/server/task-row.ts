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
  // The subqueries' references to the outer row are qualified even when the rest
  // of the list is not — see labelsSubquery. `task.id` is in scope unaliased in a
  // plain SELECT and in an UPDATE's RETURNING, which are the only two places the
  // no-alias form is used.
  const self = alias ? `${alias}.id` : "task.id";
  return `${p}id, ${p}column_id AS "columnId", ${p}title, ${p}description,
          ${p}position, ${assigneeObject(p)} AS assignee, ${p}priority,
          ${p}type, ${p}estimate, ${p}milestone_id AS "milestoneId",
          ${p}due_date AS "dueDate", ${p}parent_id AS "parentId",
          ${claimedByObject(p)} AS "claimedBy",
          ${p}claimed_at AS "claimedAt",
          ${p}created_at AS "createdAt",
          ${labelsSubquery(self)} AS labels,
          ${subtaskCountSubquery(self)} AS "subtaskCount",
          ${blockedBySubquery(self)} AS "blockedByCount",
          ${blockedByOpenSubquery(self)} AS "blockedByOpenCount",
          ${recurrenceSubquery(self)} AS recurrence,
          ${attachmentCountSubquery(self)} AS "attachmentCount",
          ${checklistSubquery(self)} AS checklist`;
}

/**
 * How many files are attached to this task (021). subtaskCountSubquery's twin,
 * and here for its reason: a read that forgot it types as a whole Task and
 * renders a card whose paperclip count is undefined, which query<Task> cannot
 * catch. ::int because COUNT(*) is bigint — "0" is truthy, so the card would draw
 * a badge for every task without the cast. `taskRef` qualified, labelsSubquery's
 * trap.
 */
function attachmentCountSubquery(taskRef: string): string {
  return `(SELECT COUNT(*)::int FROM attachment a
             WHERE a.task_id = ${taskRef})`;
}

/**
 * This task's recurrence cadence (020), or NULL when it does not recur.
 *
 * A scalar subquery, not a join, for the reason labels and subtaskCount are: a
 * read that forgot it types as a whole Task and renders a card whose repeat mark
 * is silently undefined, and query<Task> is a cast that cannot catch it. The
 * enum comes back as its text label ('daily' / 'weekly' / 'monthly'), which is
 * exactly RecurrenceFrequency. `taskRef` qualified, labelsSubquery's trap.
 */
function recurrenceSubquery(taskRef: string): string {
  return `(SELECT tr.frequency FROM task_recurrence tr
             WHERE tr.task_id = ${taskRef})`;
}

/**
 * How many tasks this one is blocked by — the count of its dependency edges (018).
 *
 * subtaskCountSubquery's twin, and here for its reason: a read that forgot it
 * would still type-check as a whole Task and render a card whose blocked-by badge
 * is undefined, because query<Task> is a cast and not a check. One list is the
 * only defence, so this joins it.
 *
 * The count only, never "N of M done": whether a blocker is finished needs a
 * completion notion, and which columns are "done" is user-defined and unknowable
 * here — the same wall subtaskCount and checklist's card badge already hit. The
 * number says the task waits on others; the dialog says on which.
 *
 * ::int because COUNT(*) is bigint, which node-postgres returns as a *string* —
 * "0" is truthy, so `blockedByCount > 0` on the card would render a badge for
 * every task without the cast. `taskRef` qualified for labelsSubquery's reason:
 * the inner scope has its own columns, and a bare correlation would compile while
 * comparing the wrong one.
 */
function blockedBySubquery(taskRef: string): string {
  return `(SELECT COUNT(*)::int FROM task_dependency td
             WHERE td.task_id = ${taskRef})`;
}

/**
 * How many of this task's blockers are still *open* — not yet in their board's
 * done column (018 + 020). This is the "blocked vs unblocked" the dependency
 * feature deferred for want of a completion notion; 020's board.done_column_id is
 * that notion, so the answer can finally be computed.
 *
 * The honest zero is the load-bearing part: a blocker counts as open only when a
 * done column EXISTS (done_column_id IS NOT NULL) and the blocker is not in it. A
 * board with no done column has no notion of "finished", so this returns 0 rather
 * than claiming every dependency blocks — the card then shows the neutral "depends
 * on N" it always did, never a false "blocked". blockedByCount stays the total, so
 * the card can tell "blocked by unfinished work" from "depends on work that is
 * done".
 *
 * ::int for the bigint-as-string trap; `taskRef` qualified for labelsSubquery's.
 * The joins walk each blocker to its own board's done column — a blocker is always
 * on the same board (addDependency enforces it), but the join makes no assumption.
 */
function blockedByOpenSubquery(taskRef: string): string {
  return `(SELECT COUNT(*)::int
             FROM task_dependency td
             JOIN task blk ON blk.id = td.depends_on_task_id
             JOIN board_column bbc ON bbc.id = blk.column_id
             JOIN board bb ON bb.id = bbc.board_id
            WHERE td.task_id = ${taskRef}
              AND bb.done_column_id IS NOT NULL
              AND blk.column_id <> bb.done_column_id)`;
}

/**
 * A task's checklist progress as a json {total, done} — the card renders "2/5"
 * from it, so both numbers arrive together rather than as two columns a caller
 * reassembles (labelsSubquery's shape).
 *
 * One scan, not two subqueries: COUNT(*) and a FILTER'd COUNT over the same
 * checklist_item rows. Both ::int for subtaskCount's reason — a bigint arrives
 * from node-postgres as a string, and "0" is truthy. No COALESCE: an aggregate
 * subquery over no rows still returns one row (0, 0), so an unchecked task reads
 * {total:0, done:0} rather than null.
 *
 * `taskRef` qualified for labelsSubquery's reason — the inner scope has its own
 * `id`, so a bare correlation would silently compare the wrong column.
 */
function checklistSubquery(taskRef: string): string {
  return `(SELECT json_build_object(
             'total', COUNT(*)::int,
             'done', (COUNT(*) FILTER (WHERE ci.done))::int)
             FROM checklist_item ci WHERE ci.task_id = ${taskRef})`;
}

/**
 * How many subtasks a task has.
 *
 * Here rather than in the one query that needs it, for 9edeff3's reason and with
 * labels as the precedent: a read that forgot it would be typed as a whole Task
 * and render a card whose count is undefined. `query<Task>` is a cast, not a
 * check, so nothing but this list stands between that and the browser.
 *
 * The cost is one more correlated subquery per task row, on top of labels'. Both
 * are index lookups — idx_task_parent leads with parent_id — and a board reads a
 * hundred tasks at most. Worth revisiting together when boards are paginated
 * (M3), not before.
 *
 * ::int because COUNT(*) is bigint, which node-postgres hands back as a *string*
 * rather than a number — the same trap moveTask's clamp already documents. Left
 * as-is it would type-check perfectly and render "3" from `subtaskCount > 0`
 * being true for the string "0".
 *
 * `taskRef` must be qualified, and this is labelsSubquery's bug waiting to
 * happen again: the inner scope has its own `id`, so a bare `WHERE s.parent_id =
 * id` would compile and quietly compare a parent_id against the subtask's own id.
 * The alias `s` is what keeps the outer reference reachable at all.
 */
function subtaskCountSubquery(taskRef: string): string {
  return `(SELECT COUNT(*)::int FROM task s WHERE s.parent_id = ${taskRef})`;
}

/**
 * The assignee as a json {type, id} object, or NULL when unassigned — unifying
 * the two peer columns (011) into the one Actor the app reasons about.
 *
 * assignee_id and agent_id are mutually exclusive by the task_one_assignee CHECK
 * (011), so this reads whichever is set. It is claimedByObject's twin, one line
 * up, and the two together are why an agent is "another kind of assignee rather
 * than a separate concept": the same Actor shape carries a human or an agent for
 * both the assignment and the claim.
 */
function assigneeObject(p: string): string {
  return `CASE WHEN ${p}assignee_id IS NOT NULL
               THEN json_build_object('type', 'human', 'id', ${p}assignee_id)
               WHEN ${p}agent_id IS NOT NULL
               THEN json_build_object('type', 'agent', 'id', ${p}agent_id)
               ELSE NULL END`;
}

/**
 * The claim holder as a json {type, id} object, or NULL when the task is free.
 *
 * Assembled in SQL rather than returned as two flat columns for the reader to
 * reassemble, which is the shape labelsSubquery already established: taskColumns
 * casts its result straight to Task, so the object that lands must already be
 * Task-shaped. claimed_by and claimed_by_type move together (010's CHECK), so
 * one NULL means both are — the CASE keys on claimed_by and trusts the invariant.
 *
 * json_build_object renders the actor_type enum as its text label ('human' /
 * 'agent'), which is exactly Actor.type. No alias qualification trap here as in
 * labelsSubquery: these are the outer row's own columns, so the caller's prefix
 * (`t.` or none) is all they need.
 */
function claimedByObject(p: string): string {
  return `CASE WHEN ${p}claimed_by IS NULL THEN NULL
               ELSE json_build_object('type', ${p}claimed_by_type,
                                      'id', ${p}claimed_by) END`;
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
    // The Actor, unified from the two peer columns (011). Written as `assignee`,
    // never the legacy `assigneeId` a pre-011 row carries — TaskSnapshot keeps
    // that field only so old rows still read. See taskColumns/assigneeObject.
    assignee: task.assignee,
    priority: task.priority,
    // Both 022 fields ride every snapshot for 006's reason: undo restores what
    // the task *was*, and a snapshot missing them is a field undo silently
    // fails to restore.
    type: task.type,
    estimate: task.estimate,
    milestoneId: task.milestoneId,
    dueDate: task.dueDate,
    labels: task.labels,
    // Never changes, so it is dead weight to every diff and load-bearing to the
    // one thing snapshots are for: undo recreating a deleted piece under the
    // parent it was a piece of. See TaskSnapshot.parentId.
    parentId: task.parentId,
    // The claim holder, so undo of a delete restores the hold and undo of a
    // release re-claims for whoever held it. claimedAt is not carried — undo
    // re-stamps now() and the exact instant means nothing to a later reader. See
    // TaskSnapshot.claimedBy.
    claimedBy: task.claimedBy,
    // No subtaskCount: a count of other rows is not state this task holds, and
    // restoring the parent restores the pieces that make it true.
  };
}
