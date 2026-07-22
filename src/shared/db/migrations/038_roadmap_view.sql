-- The Roadmap becomes a seventh saved-view lens (038).
--
-- Board/List/Calendar/Timeline/Gantt/Backlog all draw *tasks*. The roadmap draws
-- the level above them: each epic (031) is a swimlane, and the milestones (026)
-- filed under it are dated markers across a shared time track, each showing its
-- own done/total rollup. No new data — epic, milestone and milestone.due_date are
-- all already here — so, like 032/036 before it, this migration only widens the
-- one CHECK that gates a saveable lens.
--
-- 036's pattern verbatim: the 015 CHECK is inline and anonymous, so drop it (IF
-- EXISTS, so a hand-renamed one does not wedge the migration) and re-add it with
-- 'roadmap' admitted. No data migration: every existing row holds a still-legal
-- value.
ALTER TABLE saved_view DROP CONSTRAINT IF EXISTS saved_view_view_mode_check;
ALTER TABLE saved_view ADD CONSTRAINT saved_view_view_mode_check
  CHECK (view_mode IN ('board', 'list', 'calendar', 'backlog', 'timeline', 'gantt', 'roadmap'));
