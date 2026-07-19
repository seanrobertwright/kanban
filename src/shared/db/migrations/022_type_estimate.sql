-- Task type and estimate.
--
-- Two fields, one migration, and 006 is the template it follows deliberately:
-- one enum field whose empty state is a value, one nullable field whose empty
-- state cannot be. The update semantics fall out of that split exactly as they
-- did for priority and due_date, and nothing below needs a new argument.

-- A closed set, so an enum — 006's rule: enumerate what cannot grow without a
-- product decision. 'task' / 'bug' / 'story' is the set a kanban tool needs to
-- tell defect work from product-delivery work from everything else; a taxonomy
-- richer than that (epics, spikes, tickets-by-team) is the "custom fields"
-- non-goal (§5) wearing a different hat.
--
-- Declaration order carries no meaning, unlike task_priority's: nothing sorts
-- by type. The enum is for the closed set and the free CHECK, not for ORDER BY.
DO $$ BEGIN
  CREATE TYPE task_type AS ENUM ('task', 'bug', 'story');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE task
  -- NOT NULL DEFAULT 'task', priority's shape: the empty state is a value, so
  -- null stays free to mean "the caller said nothing" and COALESCE serves the
  -- update. The backfill is implicit and honest — every pre-022 task is a plain
  -- task, because nothing could have said otherwise.
  ADD COLUMN IF NOT EXISTS type task_type NOT NULL DEFAULT 'task',

  -- Story points (or any relative-effort unit — the app does not impose a
  -- scale). INTEGER, not NUMERIC: teams that estimate in halves are really
  -- estimating on a finer integer scale, and a free-form decimal invites the
  -- false precision estimates exist to avoid.
  --
  -- NULL is the empty state, unavoidably — there is no number that means
  -- "unestimated" (0 means "free", which is an estimate). So the field is
  -- three-valued on update and reuses the supplied-flag 004 built and 006
  -- reused for due_date. CHECK >= 0 keeps a typo'd negative from becoming a
  -- planning value nothing can render.
  ADD COLUMN IF NOT EXISTS estimate INTEGER CHECK (estimate >= 0);

-- No index on either, and 006's reasoning for priority covers both: the board
-- reads a column at a time and sorts a handful of rows. The query that would
-- want one — "all bugs across the board", "total points per column" — reads a
-- whole board's tasks anyway, which is a scan an index cannot beat at this size.
