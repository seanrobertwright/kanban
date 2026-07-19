-- Milestones — named checkpoints a board's tasks aim at.
--
-- Board-scoped, not workspace-scoped, unlike labels (007): a label classifies
-- ("bug", "backend") and means the same thing on every board, where a
-- milestone targets ("v1.0", "Beta launch") and is a fact about one board's
-- delivery. A second board's v1.0 is a different v1.0.
CREATE TABLE IF NOT EXISTS milestone (
  id SERIAL PRIMARY KEY,
  board_id INTEGER NOT NULL REFERENCES board(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (name <> ''),
  -- DATE, 006's argument verbatim: a target date is a calendar date, not an
  -- instant, and NULL is "no date" — a milestone can be a bucket before it is
  -- a deadline.
  due_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_milestone_board ON milestone(board_id);

ALTER TABLE task
  -- ON DELETE SET NULL, not CASCADE: deleting a milestone un-aims its tasks,
  -- it does not take their work with it — 007's label-delete line, drawn the
  -- same way for the same reason. Nullable, so the field is three-valued on
  -- update (null clears), dueDate's shape.
  ADD COLUMN IF NOT EXISTS milestone_id INTEGER
    REFERENCES milestone(id) ON DELETE SET NULL;

-- Partial, 006's due-date reasoning: most tasks aim at nothing, and the query
-- that wants this — a milestone's progress — reads by milestone_id.
CREATE INDEX IF NOT EXISTS idx_task_milestone
  ON task(milestone_id) WHERE milestone_id IS NOT NULL;
