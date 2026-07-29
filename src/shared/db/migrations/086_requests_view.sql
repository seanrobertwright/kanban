-- Requests lens (rock 1.8, SPEC §1.8): the intake queue graduates from a
-- read-only dialog to a board lens with triage. Two stored facts:
--
-- 1. A saved view may now name it — the 073 pattern, applied again.
-- 2. Triage state lives inside the existing task.request_meta JSONB (052) as a
--    `triage` sub-object ({state, at, actorType, actorId, reason?}), so accepting
--    or declining a request adds no table and no column. An untriaged request is
--    simply one whose request_meta has no `triage` key — which is every request
--    that exists today, so the queue reads "open" for all of them without a
--    backfill.
--
-- The partial index is what makes the queue cheap: requests are a small minority
-- of a board's tasks, and the queue query's whole selectivity is
-- `request_meta IS NOT NULL`.
ALTER TABLE saved_view DROP CONSTRAINT IF EXISTS saved_view_view_mode_check;
ALTER TABLE saved_view ADD CONSTRAINT saved_view_view_mode_check
  CHECK (view_mode IN ('board', 'list', 'calendar', 'backlog', 'timeline', 'gantt', 'roadmap', 'dashboard', 'requests'));

CREATE INDEX IF NOT EXISTS task_request_meta_idx
  ON task (column_id)
  WHERE request_meta IS NOT NULL;
