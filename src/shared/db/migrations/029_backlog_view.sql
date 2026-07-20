-- M4: the backlog becomes a fourth saved-view lens.
--
-- The backlog view (028's sprint_id IS NULL queue as its own surface) is a lens
-- over the board's tasks the way board/list/calendar are — so a member can save
-- it with a filter ("my P0 backlog") exactly as they save the others. That
-- makes 'backlog' a valid view_mode, which the 015 CHECK must now admit.
--
-- The constraint was inline and anonymous in 015, so Postgres named it
-- saved_view_view_mode_check; drop that (IF EXISTS, so a hand-renamed one does
-- not wedge the migration) and re-add it widened. No data migration: every
-- existing row holds one of the three old values, all still legal.
ALTER TABLE saved_view DROP CONSTRAINT IF EXISTS saved_view_view_mode_check;
ALTER TABLE saved_view ADD CONSTRAINT saved_view_view_mode_check
  CHECK (view_mode IN ('board', 'list', 'calendar', 'backlog'));
