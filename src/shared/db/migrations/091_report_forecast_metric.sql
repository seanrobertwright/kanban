-- Reports learn to project, not only to total (058 could only add up the past).
--
-- 058 fixed the metric vocabulary in a CHECK: count, sum:estimate, sum:minutes,
-- avg:cycle, sum:spend. Every one of them folds rows that already happened. The
-- financial report could therefore say what a board has spent and never what it
-- is heading for, which is the question a budget holder actually asks.
--
-- forecast:spend projects: the rate the scope has spent per delivered story
-- point, applied to the points still open, added to the spend to date. The maths
-- and its degenerate cases live in lib/report.ts (pure, unit-tested); the only
-- thing that has to change in the schema is the vocabulary, because the results
-- of a report are never stored — a definition is all a row holds.
--
-- Dropped and re-added rather than edited: a CHECK cannot be altered in place,
-- and re-adding it validates the existing corpus, so a row carrying a metric
-- this list forgot would fail the migration loudly instead of surviving
-- unconstrained.
ALTER TABLE report DROP CONSTRAINT IF EXISTS report_metric_check;
ALTER TABLE report
  ADD CONSTRAINT report_metric_check
  CHECK (metric IN (
    'count', 'sum:estimate', 'sum:minutes', 'avg:cycle', 'sum:spend',
    'forecast:spend'
  ));
