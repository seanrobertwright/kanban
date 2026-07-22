-- Automation engine (045) — the spine of Phase 1. An automation rule is a
-- board-scoped trigger→conditions→actions recipe: when an event happens on the
-- board (an activity_log action), if the resulting task/board snapshot satisfies
-- a predicate tree, run an ordered list of actions. It is a *second subscriber*
-- on the same post-commit sink webhooks (025) already ride — logActivity fans
-- out to the engine exactly as it fans out to webhooks — so a rule fires on
-- precisely the events a webhook would, and no second event bus exists.
--
-- Board-scoped for the milestone reason (026/039): a rule is a fact about how one
-- board behaves, and a second board's "when moved to Done, notify" is a different
-- rule. The whole recipe (trigger, conditions, actions) is JSONB — a small,
-- whole, read-together shape the app validates, the forms.fields / recurrence
-- precedent — not a constellation of tables to join on every fire.
CREATE TABLE IF NOT EXISTS automation_rule (
  id SERIAL PRIMARY KEY,
  board_id INTEGER NOT NULL REFERENCES board(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (btrim(name) <> ''),
  -- A disabled rule stays defined but never fires — an automation can be paused
  -- without being deleted, forms.is_open's shape one table over.
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  -- { "event": "task.moved" } — the activity_log action the rule subscribes to.
  -- The runner filters on trigger->>'event', so it is indexed below.
  trigger JSONB NOT NULL,
  -- An AND/OR predicate tree over the event's snapshot (the activity row's
  -- `after`). Default "{}" is the always-true empty tree — a rule with no
  -- conditions fires on every occurrence of its trigger event.
  conditions JSONB NOT NULL DEFAULT '{}',
  -- An ordered list of actions to apply: [{type, ...}]. Empty is a legal (inert)
  -- rule while it is being built in the dialog.
  actions JSONB NOT NULL DEFAULT '[]',
  -- The admin who authored the rule; the engine applies the rule's actions *as*
  -- this principal, so an automated change writes through the very same gates and
  -- authz a human would (a rule cannot do what its author cannot). CASCADE: a
  -- rule cannot outlive the identity it acts as. The automation_run linkage below
  -- is what records that the *rule* — not the author personally — made the change.
  created_by TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_automation_rule_board ON automation_rule(board_id);
-- The runner's hot path: "enabled rules on this board subscribed to this event".
CREATE INDEX IF NOT EXISTS idx_automation_rule_dispatch
  ON automation_rule(board_id, (trigger->>'event')) WHERE is_enabled;

-- Every fire, logged — the audit arm. One row per (rule, activity) attempt, so a
-- run is traceable to the exact event that woke it (013's activity_id linkage,
-- reused): an automated task move can be walked back to the activity that
-- triggered the rule that made it. The UNIQUE(rule_id, activity_id) is also the
-- idempotency key — a redelivered/retried event cannot double-fire a rule,
-- because the second INSERT conflicts and the runner skips it.
CREATE TABLE IF NOT EXISTS automation_run (
  id BIGSERIAL PRIMARY KEY,
  rule_id INTEGER NOT NULL REFERENCES automation_rule(id) ON DELETE CASCADE,
  -- The triggering activity_log row (BIGSERIAL there, so BIGINT here). CASCADE
  -- for the same reason agent_action.activity_id does: the run is about that
  -- event, and if the event's row is gone the run has nothing left to explain.
  activity_id BIGINT NOT NULL REFERENCES activity_log(id) ON DELETE CASCADE,
  -- matched  — trigger + conditions passed, actions applied
  -- skipped  — trigger matched but conditions failed (no actions)
  -- error    — an action threw; detail carries which and why
  -- capped   — the per-event cascade depth cap stopped this rule from firing
  status TEXT NOT NULL CHECK (status IN ('matched', 'skipped', 'error', 'capped')),
  -- Free-shaped diagnostics: the applied effects, or the error, or the depth.
  detail JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (rule_id, activity_id)
);

CREATE INDEX IF NOT EXISTS idx_automation_run_rule
  ON automation_run(rule_id, id DESC);
