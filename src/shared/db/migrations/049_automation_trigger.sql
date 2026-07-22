-- External automation connectors (049, rock 1.12) — the inbound arm. Outbound is
-- already done (the engine's webhook path + 025's HMAC-signed stream make the app
-- callable from n8n/Make/Power Automate). This is the mirror: a scoped, revocable
-- token per board that an external tool POSTs to, raising a synthetic
-- external.trigger event any rule can fire on — so an outside system can *drive* a
-- board, not only listen to it. (Native Zapier/Make listings stay ⛔ — this makes
-- the app connectable from them via generic webhooks, which is the code we own.)
--
-- The token is the credential (a webhook's shape, 025): whoever holds it may fire
-- the board's external.trigger rules and nothing else. Minted by an admin, per
-- board, deactivatable without deletion.
CREATE TABLE IF NOT EXISTS automation_trigger (
  id SERIAL PRIMARY KEY,
  board_id INTEGER NOT NULL REFERENCES board(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  -- The unguessable secret in the inbound URL. UNIQUE so a lookup is a single
  -- indexed probe and two triggers can never collide.
  token TEXT NOT NULL UNIQUE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_automation_trigger_board
  ON automation_trigger(board_id);
