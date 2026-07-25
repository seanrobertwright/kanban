-- Dashboard lens: a stat-tile overview (counts, points, at-risk list) derived
-- entirely client-side from the board the user already loaded. The only stored
-- fact is that a saved view may now name it — the 038 pattern, applied again.
ALTER TABLE saved_view DROP CONSTRAINT IF EXISTS saved_view_view_mode_check;
ALTER TABLE saved_view ADD CONSTRAINT saved_view_view_mode_check
  CHECK (view_mode IN ('board', 'list', 'calendar', 'backlog', 'timeline', 'gantt', 'roadmap', 'dashboard'));
