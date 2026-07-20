-- Sprints — timeboxed delivery cycles, with a lifecycle.
--
-- Board-scoped like a milestone (026) and for its reason: a sprint is a fact
-- about one board's delivery cadence, not a workspace-wide vocabulary. Where a
-- milestone is a target a task aims at, a sprint is a *committed scope over a
-- window* — which is why it carries a status and dates a milestone does not,
-- and why velocity and burndown (later slices) can be computed against it: they
-- measure a real completion event, not a bucket.
--
-- The stateful lifecycle (planning → active → completed) is the deliberate
-- shape (product decision, 2026-07-19): velocity is "points a *completed*
-- sprint delivered" and burndown is "remaining over the *active* sprint's
-- days", both of which need a committed scope and a definite completion, not a
-- date range you can edit after the fact.
DO $$ BEGIN
  CREATE TYPE sprint_status AS ENUM ('planning', 'active', 'completed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS sprint (
  id SERIAL PRIMARY KEY,
  board_id INTEGER NOT NULL REFERENCES board(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (name <> ''),
  goal TEXT NOT NULL DEFAULT '',
  -- Both DATE and both nullable: a planning sprint may not have committed to a
  -- window yet. startSprint defaults start_date to today when it is null;
  -- burndown (a later slice) reads these on the active sprint.
  start_date DATE,
  end_date DATE,
  status sprint_status NOT NULL DEFAULT 'planning',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sprint_board ON sprint(board_id);

-- At most one active sprint per board — the invariant the whole stateful model
-- rests on: burndown is "the active sprint", singular, so two would make the
-- question ambiguous. Enforced in the database as well as checked in startSprint
-- (which returns a clean 409), because an invariant a race can step around is
-- not one — two concurrent starts serialize here rather than both winning.
CREATE UNIQUE INDEX IF NOT EXISTS idx_sprint_one_active
  ON sprint(board_id) WHERE status = 'active';

ALTER TABLE task
  -- ON DELETE SET NULL, milestone_id's rule (026): deleting a sprint returns
  -- its tasks to the backlog, it does not destroy them. Nullable, so the field
  -- is three-valued on update (null un-schedules), dueDate's shape.
  ADD COLUMN IF NOT EXISTS sprint_id INTEGER
    REFERENCES sprint(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_task_sprint
  ON task(sprint_id) WHERE sprint_id IS NOT NULL;
