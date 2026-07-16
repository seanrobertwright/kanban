-- M1: priority and due dates.
--
-- PRD §9 calls these "the fields an agent reasons over when triaging", which is
-- what they are for: M2's acceptance criterion #1 has an agent take twenty
-- inbound bugs and "label, prioritize, and comment its reasoning on each". Two
-- of those three verbs need a column to write to. Labels are the third and land
-- next, in their own migration — they need a table, where these need a field.
--
-- §8 does not draw either of these, because it draws the wedge rather than the
-- board. That makes the shape below a decision rather than a transcription.

-- A closed set, so an enum — the same call 001 made for workspace_role, and the
-- opposite of the one 003 made for activity_log.action. The rule those two
-- established: enumerate what cannot grow without a product decision, and leave
-- TEXT for what grows every milestone. Priority is the former. Per-workspace
-- custom priorities would break this, but they are "custom fields", which §5
-- names as a non-goal outright.
--
-- The declaration order is load-bearing and is the reason this is an enum rather
-- than a SMALLINT: Postgres sorts an enum by the order its values are declared,
-- so `ORDER BY priority DESC` yields urgent → high → medium → low → none with no
-- lookup table and no magic numbers in the application. Integers would buy room
-- to interpolate a value later, which is exactly the growth we just said we do
-- not want. Adding a value later is still possible (ALTER TYPE ... ADD VALUE
-- ... BEFORE/AFTER), which is enough optionality for a closed set.
DO $$ BEGIN
  CREATE TYPE task_priority AS ENUM ('none', 'low', 'medium', 'high', 'urgent');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE task
  -- NOT NULL DEFAULT 'none', and that default is what keeps this field out of
  -- the three-valued mess 004 had to build for assignee_id.
  --
  -- 'none' is a real value meaning "nobody has triaged this", distinct from
  -- 'low' meaning "someone looked and said it can wait". Because the empty state
  -- is a *value* rather than NULL, NULL is free to mean what it means for title
  -- and description — "the caller said nothing about this field" — and the
  -- existing COALESCE($n, priority) idiom expresses an update correctly. Compare
  -- due_date directly below, which has no such value and therefore cannot.
  --
  -- The backfill is implicit: every pre-006 task becomes 'none', which is true
  -- of all of them, since nobody could set a priority. Contrast 004, where no
  -- backfill was possible and TaskSnapshot.assigneeId had to become optional to
  -- say so. Here the default *is* the honest answer, so no window is lost.
  ADD COLUMN IF NOT EXISTS priority task_priority NOT NULL DEFAULT 'none',

  -- DATE, not TIMESTAMPTZ, and this is the decision the whole field turns on.
  --
  -- A due date is a calendar date, not an instant. "Due Friday" means Friday
  -- wherever you are: it does not arrive nine hours earlier for a teammate in
  -- Tokyo, and it is not a point on a timeline that can be converted between
  -- zones. TIMESTAMPTZ would force us to invent a time of day nobody chose, pick
  -- a zone to anchor it in, and then answer "which midnight?" forever after —
  -- and it would make a date entered in Berlin render as the day before in
  -- Denver. DATE has no zone to be wrong about.
  --
  -- The cost is that "overdue" needs a zone supplied from outside, since it
  -- compares against a *today* that only a reader has. That comparison lives in
  -- the client, against the reader's own local date, which is the only frame in
  -- which the question means anything. See useToday() in shared/lib/due-date.ts.
  --
  -- NULL is the empty state here, unavoidably: there is no date that means "no
  -- due date". So this field is genuinely three-valued on update (undefined =
  -- leave alone, null = clear) and reuses the supplied-flag 004 built for
  -- assignee_id. Two fields, one migration, opposite update semantics — and the
  -- thing that decides which is simply whether the field has a non-null value
  -- meaning "empty". Priority has one. This does not.
  ADD COLUMN IF NOT EXISTS due_date DATE;

-- Partial, for the same reason 004's assignee index is: most rows are NULL, and
-- nothing asks for "tasks with no due date" — the board reads by column. What
-- needs this is a date range across a board, which is precisely M3's calendar
-- view, and M4's sprint planning after it.
CREATE INDEX IF NOT EXISTS idx_task_due_date
  ON task(due_date) WHERE due_date IS NOT NULL;

-- Priority deliberately gets no index, and the asymmetry with the line above is
-- reasoned rather than an oversight. Nothing queries by priority yet: the board
-- reads a column at a time and sorts a handful of rows, which an index cannot
-- beat. The query that would want one — "the backlog, highest priority first,
-- across a board" — is M4's, and its shape is unknown enough that an index built
-- today would likely be the wrong one. The due_date index is justified only
-- because M3 names the query that reads it.
