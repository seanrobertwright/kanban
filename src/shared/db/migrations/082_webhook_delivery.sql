-- Webhook delivery log and retry queue (025 follow-up).
--
-- 025 shipped delivery as fire-and-forget with two telemetry columns on the
-- webhook row (last_status, last_delivery_at), and said plainly that a durable
-- delivery log was later work. This is that work, and the reason it could not
-- stay deferred is what those two columns cannot express: they are overwritten
-- per attempt, so a subscriber whose endpoint was down for ten minutes has no
-- way to learn *which* events it missed, and the app has no way to send them
-- again. "It is failing" is a monitoring answer; "here is the event you did not
-- get" is a correctness one.
--
-- One row per (webhook, activity) — not per attempt. An attempt count and the
-- last error live on the row and are updated in place, because the question
-- anyone asks is "did this event get through, and if not why", never "what did
-- the third of five attempts return". A row-per-attempt table is a table that
-- needs pruning to stay usable; this one has a natural cap of one row per event
-- per subscriber and prunes by age alone.
CREATE TABLE IF NOT EXISTS webhook_delivery (
  id BIGSERIAL PRIMARY KEY,
  webhook_id INTEGER NOT NULL REFERENCES workspace_webhook(id) ON DELETE CASCADE,
  -- The activity entry being delivered. No FK: activity_log is swept by the
  -- retention policies (064), and a delivery record outliving its source entry
  -- is a true statement about what was sent, not a dangling pointer.
  activity_id BIGINT NOT NULL,
  -- The event name, copied rather than joined, for the same reason: the log
  -- must still read after retention takes the activity row.
  action TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  -- The last attempt's HTTP status, or 0 for "unreachable" — 025's convention,
  -- kept so the two surfaces agree. NULL until the first attempt finishes.
  last_status INTEGER,
  last_error TEXT,
  -- Delivered, dead, or waiting. 'pending' rows are what the drainer picks up;
  -- 'failed' is the terminal state after the attempt budget is spent, and it is
  -- deliberately distinct from 'pending' so a permanently broken subscriber
  -- does not keep a queue growing forever.
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'delivered', 'failed')),
  -- When the next attempt becomes eligible. Set to now() for the first try and
  -- pushed out by exponential backoff after each failure.
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- At most one delivery record per event per subscriber. This is what makes
  -- the whole thing idempotent: a retried request, a double-queued after()
  -- callback, or two app instances racing all converge on one row rather than
  -- delivering the same event twice.
  UNIQUE (webhook_id, activity_id)
);

-- The drainer's query: eligible pending work, oldest first.
CREATE INDEX IF NOT EXISTS idx_webhook_delivery_due
  ON webhook_delivery(next_attempt_at)
  WHERE status = 'pending';

-- The admin's query: this webhook's recent history.
CREATE INDEX IF NOT EXISTS idx_webhook_delivery_hook
  ON webhook_delivery(webhook_id, created_at DESC);
