-- SLA management (050, rock 1.6) — service timers with breach + escalation, on
-- the automation engine. A policy says "tasks matching <applies_when> must reach
-- their target within <target_mins>, and on breach run <action_on_breach>"; a
-- per-task timer records when the clock started and when it is due. Elapsed and
-- remaining are DERIVED (now() vs due_at), never stored — the derive-don't-store
-- rule; only started_at / due_at / breached_at are facts.
CREATE TABLE IF NOT EXISTS sla_policy (
  id SERIAL PRIMARY KEY,
  board_id INTEGER NOT NULL REFERENCES board(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (btrim(name) <> ''),
  -- Which tasks the policy times — the engine's Condition tree (default {} = all).
  applies_when JSONB NOT NULL DEFAULT '{}',
  target_mins INTEGER NOT NULL CHECK (target_mins > 0),
  -- The engine actions to run when a timer breaches: notify/escalate/label, etc.
  action_on_breach JSONB NOT NULL DEFAULT '[]',
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  created_by TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sla_policy_board ON sla_policy(board_id);

-- One live timer per (task, policy). The task FK CASCADEs — a timer has no
-- meaning without its task — which is why this, unlike the activity log, keeps a
-- real foreign key: it is live operational state, not an immutable audit record.
CREATE TABLE IF NOT EXISTS task_sla (
  id BIGSERIAL PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES task(id) ON DELETE CASCADE,
  policy_id INTEGER NOT NULL REFERENCES sla_policy(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  due_at TIMESTAMPTZ NOT NULL,
  -- Null until the sweep finds now() past due_at; then stamped once, so a breach
  -- fires its action exactly once.
  breached_at TIMESTAMPTZ,
  UNIQUE (task_id, policy_id)
);

-- The breach sweep's scan: "open timers now past due". Partial — only the timers
-- still running (not yet breached) matter to it.
CREATE INDEX IF NOT EXISTS idx_task_sla_open
  ON task_sla(due_at) WHERE breached_at IS NULL;
