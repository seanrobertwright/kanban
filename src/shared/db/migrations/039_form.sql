-- Forms / intake (039) — a reusable, structured request capture that produces a
-- task. A Form is a board-scoped intake definition: a name, a set of questions,
-- and a target column its submissions land in. Submitting a form creates a task
-- (title from the first answer, the rest compiled into the description), so an
-- intaker fills a shaped request without having to know the board's internals.
--
-- Board-scoped for the milestone reason (026): a form ("Bug report", "Feature
-- request") is a fact about one board's intake, and a second board's "Bug report"
-- is a different form.
CREATE TABLE IF NOT EXISTS form (
  id SERIAL PRIMARY KEY,
  board_id INTEGER NOT NULL REFERENCES board(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (btrim(name) <> ''),
  -- Shown above the questions when filling the form. Two-valued like a task's
  -- description — "" is "no blurb", never null.
  description TEXT NOT NULL DEFAULT '',
  -- Where a submission's task lands. SET NULL, board.done_column_id's shape (020):
  -- deleting the column un-targets the form rather than taking it down, and the
  -- submit path falls back to the board's first column when this is null.
  target_column_id INTEGER REFERENCES board_column(id) ON DELETE SET NULL,
  -- The intake questions in order: [{label, type, required}], type in
  -- text|textarea|number. JSONB, the recurrence/custom-field-options precedent —
  -- a small, whole, read-together shape the app validates, not a table to join.
  -- The first question is the one whose answer becomes the task title.
  fields JSONB NOT NULL DEFAULT '[]',
  -- A closed form stays defined but refuses submissions — an intake channel can be
  -- paused without being deleted.
  is_open BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_form_board ON form(board_id);
