-- M3 (Core Work Items): recurring tasks — spawn the next one on completion.
--
-- The one real decision is what "on completion" *means*, because this board has
-- no intrinsic done-state and says so on purpose: which column counts as finished
-- is user-defined, which is why the card's badges (subtaskCount, checklist,
-- blockedByCount) all refuse to render a "done" they cannot know. Recurrence
-- needs exactly the completion signal the rest of the app declined to invent, so
-- this migration adds the least-invasive honest one: a board may *name* which of
-- its columns means done.
--
--   board.done_column_id — the column that completes a task on this board. NULL
--   until an admin sets it, and recurrence is inert while it is NULL. ON DELETE
--   SET NULL, not CASCADE: deleting the done column unsets the designation, it
--   does not delete the board. This is status = which column (M0's model) made
--   explicit for one purpose, and a fact a later feature can reuse — cycle time,
--   or the blocked-vs-unblocked the dependency card deferred for want of it.
--
-- On-complete, not scheduled, was the product call: a recurring task spawns its
-- successor when it is *moved into the done column*, which is a drag the user
-- already does — no new "complete" button, no background job. moveTask is where
-- the crossing is detected (before.column != done AND after.column == done), and
-- the successor is born in the board's first column with its due date advanced by
-- the rule.
--
-- The invariant that keeps it from double-spawning: exactly one live occurrence
-- carries the recurrence at a time. On spawn, the rule moves from the completed
-- task to the new one — so the completed task, now sitting in Done, no longer
-- recurs, and dragging it back and forth does nothing. The successor is the only
-- row that will recur next.
--
-- No activity_log rows for setting or clearing a rule, and none in TaskSnapshot —
-- 018's reasoning, reused. A recurrence rule is configuration on a task, not a
-- field undo reconstructs; the spawn itself logs a plain task.created for the
-- successor, which is the event a reader and an undo actually want. Carrying the
-- rule in a snapshot would need a completion action and a respawn-on-undo model
-- no milestone asks for.

ALTER TABLE board
  ADD COLUMN IF NOT EXISTS done_column_id INTEGER
    REFERENCES board_column(id) ON DELETE SET NULL;

DO $$ BEGIN
  CREATE TYPE recurrence_frequency AS ENUM ('daily', 'weekly', 'monthly');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- One row per recurring task, keyed on the task — a task recurs or it does not,
-- so this is 1:1 and the primary key says so. CASCADE: the rule is meaningless
-- without the task it belongs to (comment.task_id's reasoning), and a deleted
-- task's rule is nothing anyone keeps.
CREATE TABLE IF NOT EXISTS task_recurrence (
  task_id    INTEGER PRIMARY KEY REFERENCES task(id) ON DELETE CASCADE,
  frequency  recurrence_frequency NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
