-- Outbound webhooks, per workspace.
--
-- The activity log is already the one place every mutation lands (003), so a
-- webhook is simply that stream crossing the process boundary: after an entry
-- commits, its row is POSTed to every subscriber whose filter matches. No new
-- event taxonomy — the ActivityAction names ARE the event names, which is what
-- keeps a subscriber's view and the in-app history from ever disagreeing.
CREATE TABLE IF NOT EXISTS workspace_webhook (
  id SERIAL PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  -- The HMAC key, stored in the clear — unlike an agent token's hash (009),
  -- because signing needs the key itself on every delivery. The mitigations
  -- are scope (it signs outbound payloads, it authorizes nothing inbound) and
  -- audience (the list read is admin-gated and omits it; it is shown once at
  -- creation, the agent-token convention).
  secret TEXT NOT NULL,
  -- Which actions to deliver; '{}' means all. TEXT[] rather than an enum
  -- array for 003's reason: the action vocabulary grows every milestone, and
  -- a subscriber naming a not-yet-existing action is a wish, not an error.
  events TEXT[] NOT NULL DEFAULT '{}',
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Delivery telemetry, overwritten per attempt: enough for an admin to see
  -- "it is failing" without a delivery-log table nobody would prune.
  last_status INTEGER,
  last_delivery_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_workspace_webhook_ws
  ON workspace_webhook(workspace_id);
