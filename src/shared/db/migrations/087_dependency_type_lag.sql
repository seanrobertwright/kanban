-- Typed dependencies with lag (code-review §2.1, `dependencies`): an edge stops
-- meaning only "finish that, then start this".
--
-- 018 built one relationship — task_id is blocked by depends_on_task_id — and
-- read it everywhere as finish-to-start. That is the common case and stays the
-- default, but it cannot say the two true things a plan needs beside it:
--
--   SS  "these start together"  — write the docs alongside the feature, not after
--   FF  "these finish together" — QA cannot sign off before the build does
--
-- and it cannot say *how far apart* either end sits. Both are added here.
--
-- SF ("this cannot finish until that starts") is deliberately NOT in the enum,
-- and its absence is a decision rather than an oversight. It is the one link
-- type that runs backwards — it only earns its keep when a plan is scheduled
-- from its end date toward the present, which nothing in this app does: every
-- consumer (proposeSchedule, the Gantt's forward pass, the critical path) walks
-- blockers forward from a start date. Adding a fourth arm those three would have
-- to special-case, to express a relationship no user has asked for, buys a
-- vocabulary entry and a permanent maintenance cost. The CHECK below is the
-- place to add it the day someone wants it.
--
-- `lag_days` is signed on purpose. Positive is lag ("start two days after that
-- finishes" — a cure time, a review window); negative is lead ("start two days
-- before that finishes" — overlap the tail of one task with the head of the
-- next). Lead is the reason this is not a NATURAL/CHECK >= 0 column: an overlap
-- is the single most common thing a planner reaches for after the link type
-- itself, and forbidding it would push people back to fudging the dates.
--
-- Bounded at a year either way. Not a domain rule — nothing breaks at 400 — but
-- an unbounded integer here is a typo surface: `lag_days = 20260729` from a
-- date pasted into the wrong field would push a schedule 55,000 years out and
-- the arithmetic would happily comply. A year is far past any real link and
-- close enough to catch a fat finger.
--
-- Both columns are NOT NULL with defaults, so every edge written by 018 reads as
-- FS/0 — exactly what every consumer already assumed. This migration therefore
-- changes no existing schedule, which is the property that lets it ship ahead of
-- the scheduling maths that will read it.
--
-- No cycle-rule change. A cycle is a property of the graph's shape, not of what
-- the edges mean, so addDependency's board-locked reachability walk in
-- features/dependencies/server/repository.ts is untouched and still correct: an
-- SS edge closing a loop is as refused as an FS one. (Formal CPM can sometimes
-- schedule a typed cycle — an SS/FF pair between two tasks is feasible. This
-- table keeps the DAG rule anyway: it is what every consumer's termination
-- argument rests on, and "these two run together" is already sayable as one SS
-- edge without a second one pointing back.)

ALTER TABLE task_dependency
  ADD COLUMN IF NOT EXISTS dep_type TEXT NOT NULL DEFAULT 'FS',
  ADD COLUMN IF NOT EXISTS lag_days INTEGER NOT NULL DEFAULT 0;

ALTER TABLE task_dependency DROP CONSTRAINT IF EXISTS task_dependency_type_check;
ALTER TABLE task_dependency ADD CONSTRAINT task_dependency_type_check
  CHECK (dep_type IN ('FS', 'SS', 'FF'));

ALTER TABLE task_dependency DROP CONSTRAINT IF EXISTS task_dependency_lag_check;
ALTER TABLE task_dependency ADD CONSTRAINT task_dependency_lag_check
  CHECK (lag_days BETWEEN -365 AND 365);
