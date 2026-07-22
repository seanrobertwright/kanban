-- Recurring automation rules (047, rock 1.4) — scheduled rules that fire on a
-- timer ("every day") rather than on a board event. Reuses the durable run-queue
-- drainer (030): the sweep that re-dispatches stranded agent runs also ticks the
-- scheduled automations, so no new worker is introduced.
--
-- next_run_at drives it: a schedule.tick rule stores when it is next due; the
-- scheduler fires every rule whose next_run_at has passed and advances it by the
-- rule's interval. NULL for ordinary event rules, which have no schedule.
ALTER TABLE automation_rule ADD COLUMN IF NOT EXISTS next_run_at TIMESTAMPTZ;

-- The scheduler's scan: "scheduled rules that are due". Partial — only the rules
-- that actually carry a next_run_at, a small slice of all rules.
CREATE INDEX IF NOT EXISTS idx_automation_rule_due
  ON automation_rule(next_run_at) WHERE next_run_at IS NOT NULL;

-- A scheduled fire has no triggering activity_log row (nothing happened — a timer
-- elapsed), so a run recorded for it carries no activity_id. Relax the NOT NULL;
-- the UNIQUE(rule_id, activity_id) idempotency key still applies to event-driven
-- runs (NULLs are distinct in a UNIQUE, so scheduled runs are simply never
-- de-duplicated by it — next_run_at advancement is their once-per-tick guard).
ALTER TABLE automation_run ALTER COLUMN activity_id DROP NOT NULL;
