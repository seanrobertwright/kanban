-- Task start date + the Timeline lens it unlocks.
--
-- A due date says when work is due; a start date says when it begins. Together
-- they are a bar on a timeline — the one view the board could not draw before,
-- because a single date is a point (the calendar) and a span needs two.
ALTER TABLE task
  -- DATE, 006's argument verbatim: a start date is a calendar date, not an
  -- instant, and NULL is "no start date" — most tasks never carry one, and the
  -- field is three-valued on update (null clears), dueDate's shape.
  ADD COLUMN IF NOT EXISTS start_date DATE;

-- No index: like the calendar over due_date, the Timeline reads a board's tasks
-- whole and buckets them client-side — there is no query that filters by
-- start_date, so an index would be dead weight. (milestone_id earned one because
-- a milestone's progress query reads *by* it; nothing reads by start_date.)

-- Timeline becomes a fifth saved-view lens — a member can save it with a filter
-- ("my Q3 timeline") exactly as they save board/list/calendar/backlog. 029's
-- pattern verbatim: the 015 constraint is inline and anonymous, so drop it (IF
-- EXISTS, so a hand-renamed one does not wedge the migration) and re-add it
-- widened. No data migration: every existing row holds a still-legal value.
ALTER TABLE saved_view DROP CONSTRAINT IF EXISTS saved_view_view_mode_check;
ALTER TABLE saved_view ADD CONSTRAINT saved_view_view_mode_check
  CHECK (view_mode IN ('board', 'list', 'calendar', 'backlog', 'timeline'));
