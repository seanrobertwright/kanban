-- Epics — the grouping a board's work rolls up into, one level above a milestone.
--
-- Board-scoped for milestone's reason (026): an epic targets a body of work
-- ("Billing", "Onboarding") that is a fact about one board's delivery, and a
-- second board's "Billing" is a different epic. Unlike a milestone it carries no
-- due_date — an epic is an open-ended bucket a milestone lives *inside*, and the
-- date that matters is the milestone's, not the epic's. Name only.
CREATE TABLE IF NOT EXISTS epic (
  id SERIAL PRIMARY KEY,
  board_id INTEGER NOT NULL REFERENCES board(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (name <> ''),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_epic_board ON epic(board_id);

-- An epic groups on two levels, so it earns two SET NULL back-references — the
-- same un-group-never-destroy shape milestone's task FK draws (026), for the same
-- reason: deleting an epic un-files its tasks and milestones, it does not take
-- their work with it, which is why the epic repository can gate deletion at
-- member rather than admin.

-- Tasks that belong to the epic directly (a task need not go through a milestone).
ALTER TABLE task
  ADD COLUMN IF NOT EXISTS epic_id INTEGER
    REFERENCES epic(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_task_epic
  ON task(epic_id) WHERE epic_id IS NOT NULL;

-- Milestones that belong to the epic — the "above the milestone" hierarchy. An
-- epic's progress rolls up the tasks of its member milestones as well as its
-- direct tasks (see epics/server/repository.ts).
ALTER TABLE milestone
  ADD COLUMN IF NOT EXISTS epic_id INTEGER
    REFERENCES epic(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_milestone_epic
  ON milestone(epic_id) WHERE epic_id IS NOT NULL;
