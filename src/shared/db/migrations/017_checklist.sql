-- M3 (Core Work Items): per-task checklists.
--
-- Distinct from subtasks (008), deliberately. A subtask IS a task — its own
-- status, assignee, priority, an agent can claim and work it. A checklist item
-- is none of that: a line of text and a tick, the lightest possible unit of "and
-- don't forget to…". Modelling the two as one thing would either burden every
-- checkbox with a task's machinery or strip a subtask down to a label.
--
-- No activity_log rows, and that is the one real decision here. Every task-state
-- mutation logs (M1's criterion), but a checklist tick is the finest grain of
-- task *content* — logging each toggle would bury assignments and moves under
-- bookkeeping the way logging each description keystroke would. A checklist is
-- content like the description, and the description does not log per edit either.

CREATE TABLE IF NOT EXISTS checklist_item (
  id         SERIAL PRIMARY KEY,
  task_id    INTEGER NOT NULL REFERENCES task(id) ON DELETE CASCADE,
  content    TEXT NOT NULL,
  done       BOOLEAN NOT NULL DEFAULT false,
  position   INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The one read is "this task's items, in order"; the delete cascades from task.
CREATE INDEX IF NOT EXISTS idx_checklist_item_task
  ON checklist_item(task_id, position);
