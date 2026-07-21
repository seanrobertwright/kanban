-- Goals / OKRs (037) — measurable objectives a board's work aims at.
--
-- An Objective is a qualitative outcome ("Delight new users"); its Key Results
-- are the measurable targets that say whether it was met ("NPS 30 → 50"). Board-
-- scoped for the milestone reason (026): an objective is a fact about one board's
-- delivery, and a second board's "Delight new users" is a different objective.
--
-- Two things link to an objective, epic's two SET NULL back-references (031) and
-- for its reason: tasks aim directly, milestones aim as a group, and deleting an
-- objective un-aims its work without taking any of it — which is why the
-- objectives repository can gate deletion at member rather than admin.
CREATE TABLE IF NOT EXISTS objective (
  id SERIAL PRIMARY KEY,
  board_id INTEGER NOT NULL REFERENCES board(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (btrim(name) <> ''),
  -- The qualitative statement of intent. NOT NULL DEFAULT '' so it is two-valued
  -- like a task's description — "" is "no detail", never null.
  description TEXT NOT NULL DEFAULT '',
  -- Optional deadline: OKRs are usually quarter-boxed, but an objective can be a
  -- standing aim. DATE, 006's argument — a calendar date, not an instant.
  due_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_objective_board ON objective(board_id);

-- A Key Result: one measurable target under an objective. CASCADE, not SET NULL —
-- a key result has no life apart from its objective, so deleting the objective
-- takes its measures with it (the objective/KR relationship is composition, where
-- objective/task is association).
--
-- Progress is computed, not stored: (current - start) / (target - start), clamped
-- to [0, 1]. Storing start as well as target is what lets a *decreasing* metric
-- read correctly — churn 9 → 4 with current 6 is (6-9)/(4-9) = 0.6, three-fifths
-- of the way down — where target-only maths would divide by the wrong span. The
-- values are DOUBLE PRECISION: a KR can measure a percentage, a count, or a
-- rating, and a float carries all three without a scale decision per unit.
CREATE TABLE IF NOT EXISTS key_result (
  id SERIAL PRIMARY KEY,
  objective_id INTEGER NOT NULL REFERENCES objective(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (btrim(title) <> ''),
  start_value DOUBLE PRECISION NOT NULL DEFAULT 0,
  target_value DOUBLE PRECISION NOT NULL,
  current_value DOUBLE PRECISION NOT NULL DEFAULT 0,
  -- The unit the three numbers are in ("%", "NPS", "reviews"), for display only.
  -- NOT NULL DEFAULT '' — two-valued like description.
  unit TEXT NOT NULL DEFAULT '',
  -- Ordering within an objective, so the KR list is stable and reorderable.
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_key_result_objective ON key_result(objective_id);

-- Tasks that aim at the objective directly. SET NULL, milestone_id's shape (026):
-- un-aim on delete, three-valued on update (null clears).
ALTER TABLE task
  ADD COLUMN IF NOT EXISTS objective_id INTEGER
    REFERENCES objective(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_task_objective
  ON task(objective_id) WHERE objective_id IS NOT NULL;

-- Milestones that aim at the objective — a whole checkpoint contributing to an
-- outcome. epic_id's twin (031), same SET NULL, same partial index.
ALTER TABLE milestone
  ADD COLUMN IF NOT EXISTS objective_id INTEGER
    REFERENCES objective(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_milestone_objective
  ON milestone(objective_id) WHERE objective_id IS NOT NULL;
