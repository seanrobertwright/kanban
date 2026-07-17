-- M2: the run substrate — Door 1's execution, action, and changeset records.
--
-- PRD §8 diagrams three tables hanging off the agent:
--
--   agent ──< agent_run          (one execution: task, status, tokens, cost)
--                └──< agent_action  (one tool call: tool, input, result, tier,
--                                    before/after, approved_by, reverted_at)
--   changeset ──> agent_run      (a batch of proposed actions awaiting review)
--
-- This is those three. A run is what an assignment starts (011's trigger seam);
-- an action is one gated tool call inside it (§7.4); a changeset is the batch a
-- human reviews as one diff — "a pull request for the board".
--
-- The FK calls follow 003's rule, now stated for a third table: a record that is
-- HISTORY carries no FK to what it describes, so it can outlive it. A run's cost
-- is billing history — it must survive the deletion of the task it worked, or a
-- workspace could erase what it was charged for by tidying its board. So task_id
-- here has no FK, exactly as activity_log.task_id does not. What a run cannot
-- outlive is its own agent and workspace: those disappear only on workspace
-- teardown, which cascades everything, so those ARE real FKs.

DO $$ BEGIN
  -- queued  -> the assignment enqueued it; nothing is running yet (the fast
  --            in-transaction write that IS the trigger).
  -- running -> the loop is turning.
  -- awaiting_review -> the loop finished and left a changeset for a human.
  -- succeeded / failed -> terminal, no review pending.
  -- halted  -> stopped mid-loop because the workspace budget cap was hit (§7.3,
  --            acceptance #5: "a runaway loop is a financial incident").
  -- A closed set, so an enum — 001's rule, the same one workspace_role follows.
  CREATE TYPE agent_run_status AS ENUM (
    'queued', 'running', 'awaiting_review', 'succeeded', 'failed', 'halted'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  -- §7.4's three gates, by blast radius: auto executes now with an undo window;
  -- changeset is held for one human review; block never runs autonomously. A
  -- closed set (the design rejects a fourth, per §7.4's "reject confidence
  -- thresholds"), so an enum, where the tool name below stays TEXT.
  CREATE TYPE agent_tier AS ENUM ('auto', 'changeset', 'block');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE changeset_status AS ENUM (
    'pending', 'accepted', 'rejected', 'partial'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS agent_run (
  id            TEXT PRIMARY KEY,

  -- A run belongs to its agent, and dies with it. Unlike task_id below, this IS
  -- a real FK: an agent is deleted only when its workspace is (009), and a run
  -- without an agent is not history worth keeping — it is an orphan of a teardown.
  agent_id      TEXT NOT NULL REFERENCES agent(id) ON DELETE CASCADE,

  -- No FK, and this is the whole reason the run is a record and not a live view.
  -- 003's rule: history outlives its subject. A run's cost and action trail are
  -- what the workspace was billed for; deleting the task must not erase them, or
  -- the audit and the meter both lie. Safe because SERIAL never reuses task ids.
  task_id       INTEGER,

  -- Denormalized, and only for the reason activity_log denormalizes it: the
  -- budget query sums a workspace's runs, and a run may have no task left to join
  -- through. CASCADE so a deleted tenant's runs go with it (belt to agent_id's
  -- braces — either FK alone would carry a workspace teardown).
  workspace_id  TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,

  status        agent_run_status NOT NULL DEFAULT 'queued',

  -- Telemetry, kept in full because §7.3 makes the M6 pricing decision "evidence-
  -- based rather than a guess" (§12, Q1). Cache tokens are split out because they
  -- are ~0.1x the price of fresh input — the board-context prefix is cached every
  -- turn (§7.3), so lumping them into input_tokens would overstate cost by ~10x
  -- on a multi-turn run.
  input_tokens          INTEGER NOT NULL DEFAULT 0,
  output_tokens         INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens     INTEGER NOT NULL DEFAULT 0,
  cache_creation_tokens INTEGER NOT NULL DEFAULT 0,

  -- Cost in MICRO-DOLLARS (millionths of a dollar), not cents, and BIGINT so it
  -- sums without rounding. A run is $0.15-0.30 (§7.3) — cents would round a
  -- $0.02 turn to nothing, and a budget cap summed from rounded runs drifts. In
  -- micros the per-token prices are clean integers (opus-4-8: 5 in / 25 out per
  -- token), so the number is exact end to end. The workspace budget (014) is in
  -- the same unit, so the cap comparison never converts.
  cost_micros   BIGINT NOT NULL DEFAULT 0,

  -- The failure sentence for a 'failed' run — surfaced to the reviewer, the way a
  -- tool error is. NULL on every other status.
  error         TEXT,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at   TIMESTAMPTZ
);

-- The budget window: "this workspace's runs, newest first" is how spend is summed
-- (014) and how the board finds a task's latest run for its status badge.
CREATE INDEX IF NOT EXISTS idx_agent_run_workspace
  ON agent_run(workspace_id, created_at DESC);
-- "the latest run for this task" — the run-state affordance on the assignee
-- avatar (018) reads it. Partial: a run always has an agent but a run kicked off
-- by the isolated test endpoint may have no task, and nothing reads those by task.
CREATE INDEX IF NOT EXISTS idx_agent_run_task
  ON agent_run(task_id, created_at DESC) WHERE task_id IS NOT NULL;

-- One changeset per run: the loop works to completion and proposes ONE batch
-- (§7.4). Created lazily, when the first changeset-tier action is proposed — a
-- run whose every action was auto-tier has none, and its status goes straight to
-- 'succeeded' rather than 'awaiting_review'.
CREATE TABLE IF NOT EXISTS changeset (
  id           TEXT PRIMARY KEY,
  run_id       TEXT NOT NULL UNIQUE REFERENCES agent_run(id) ON DELETE CASCADE,
  status       changeset_status NOT NULL DEFAULT 'pending',
  -- The human who reviewed it. No FK, actor_id's reasoning: it is a record of who
  -- acted at a moment past, and must survive their account. NULL until reviewed.
  reviewed_by  TEXT,
  reviewed_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_action (
  id            TEXT PRIMARY KEY,

  -- An action belongs to its run and dies with it — the run is the unit of
  -- history, and a tool call detached from the run that made it means nothing.
  run_id        TEXT NOT NULL REFERENCES agent_run(id) ON DELETE CASCADE,

  -- Which changeset holds this action, for the changeset-tier ones. NULL for
  -- auto-tier (executed immediately, never batched) and block-tier (refused,
  -- never proposed). SET NULL rather than CASCADE: an action is history and
  -- outlives the changeset's disposition — a rejected changeset's actions still
  -- record what the agent proposed.
  changeset_id  TEXT REFERENCES changeset(id) ON DELETE SET NULL,

  -- The tool name, TEXT for 003's reason: the tool set grows every milestone, and
  -- an enum would need an ALTER TYPE each time. The tier beside it IS an enum,
  -- because the three gates are the closed set the tool names are not.
  tool          TEXT NOT NULL,
  tier          agent_tier NOT NULL,

  -- What the model asked for, and what it got back. result is NULL for a proposed
  -- changeset action (no mutation ran yet) and a blocked one (none ever will).
  input         JSONB NOT NULL,
  result        JSONB,

  -- The undo substrate, same shape and reasoning as activity_log's: full
  -- snapshots, not diffs, so revert replays the inverse by reading one row. NULL
  -- on the side the task did not exist (a create has no before).
  before        JSONB,
  after         JSONB,

  -- The activity_log row this action produced, once it actually mutated the
  -- board. A BIGINT pointing at activity_log.id (BIGSERIAL, 003) with no FK, for
  -- the same reason nothing else FKs into the append-only log: the log is only
  -- ever deleted by workspace teardown, which cascades this row too. NULL while
  -- the action is merely proposed (changeset) or refused (block) — it names the
  -- mutation, and there is none until a human accepts.
  activity_id   BIGINT,

  -- Who accepted this proposed action (changeset review). NULL for auto-tier
  -- (nobody approved it — that is the point of the tier) and for a still-pending
  -- or rejected proposal. No FK, reviewed_by's reasoning.
  approved_by   TEXT,
  -- The undo stamp: when this action's mutation was reverted. NULL means live.
  reverted_at   TIMESTAMPTZ,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The run's action trail, in the order the model made the calls — what the
-- changeset review renders and what undo walks.
CREATE INDEX IF NOT EXISTS idx_agent_action_run
  ON agent_action(run_id, created_at);
-- A changeset's proposed actions, read together at review time.
CREATE INDEX IF NOT EXISTS idx_agent_action_changeset
  ON agent_action(changeset_id) WHERE changeset_id IS NOT NULL;
