-- M2 hardening: make a run recoverable by giving it a heartbeat.
--
-- 013 made a run a durable record so a crash could not lose it — but nothing ever
-- picked a stranded run back up. dispatchRun (runtime.ts) rides Next's after(),
-- which fires off the request path on the SAME process: if that process dies
-- between the enqueue COMMIT and the callback (a deploy, a crash, an OOM), the row
-- sits at 'queued' forever with no worker, and a run that was mid-flight sits at
-- 'running' forever with no loop. 013 gave the run only created_at and
-- finished_at, so a stalled run is indistinguishable from a fresh one by age
-- alone, and a crashed 'running' run has no liveness signal at all.
--
-- Two timestamps fix that. started_at marks the claim (queued → running), so the
-- drainer can tell a run that has actually begun from one still waiting.
-- last_heartbeat_at is bumped every model turn (runtime.ts) — a crashed run stops
-- bumping it, so a 'running' row whose heartbeat has gone stale is provably
-- abandoned and safe to requeue. Both are nullable: a queued run has neither yet.
ALTER TABLE agent_run
  ADD COLUMN IF NOT EXISTS started_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_heartbeat_at TIMESTAMPTZ;

-- Backfill the runs that predate the columns: any run already 'running' when this
-- lands has no heartbeat, and the drainer must not read that null as "crashed
-- long ago" and yank a live run out from under itself. Seed both from created_at —
-- a genuinely stalled legacy run is then old enough to sweep on the next tick, and
-- a live one re-bumps its heartbeat on its very next turn.
UPDATE agent_run
   SET started_at = COALESCE(started_at, created_at),
       last_heartbeat_at = COALESCE(last_heartbeat_at, created_at)
 WHERE status = 'running';

-- The drainer's scan: "queued or running runs, oldest first". Neither existing
-- index touches status (both are workspace/task ordered), so without this the
-- sweep is a seqscan of every run ever. Partial, because the two active statuses
-- are a tiny, shrinking slice of a table that is mostly terminal rows.
CREATE INDEX IF NOT EXISTS idx_agent_run_active
  ON agent_run(created_at)
  WHERE status IN ('queued', 'running');
