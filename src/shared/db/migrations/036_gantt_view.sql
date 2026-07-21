-- The Gantt becomes a sixth saved-view lens (036).
--
-- The Timeline (032) draws each task as a start→due bar. A Gantt is that same
-- picture with the dependency graph (018) drawn on top: arrows from a blocker to
-- the work it blocks, and the schedule-driving critical path highlighted. No new
-- data — start_date, due_date and task_dependency are all already here — so this
-- migration only widens the one constraint that gates a saveable lens.
--
-- 032's pattern verbatim: the 015 CHECK is inline and anonymous, so drop it (IF
-- EXISTS, so a hand-renamed one does not wedge the migration) and re-add it with
-- 'gantt' admitted. No data migration: every existing row holds a still-legal
-- value.
ALTER TABLE saved_view DROP CONSTRAINT IF EXISTS saved_view_view_mode_check;
ALTER TABLE saved_view ADD CONSTRAINT saved_view_view_mode_check
  CHECK (view_mode IN ('board', 'list', 'calendar', 'backlog', 'timeline', 'gantt'));
