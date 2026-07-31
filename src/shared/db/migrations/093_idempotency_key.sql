-- Idempotency keys on creates (code review §4.4 item 3).
--
-- The hole this closes is stated in the MCP door's own comment: a POST that
-- timed out may well have been applied — the socket died, not the transaction —
-- so retrying it risks a second task, a second comment, a second claim. That
-- left every mutation permanently un-retryable, which turns one dropped packet
-- into an agent that has no idea whether its work landed.
--
-- A key makes the question answerable: the server remembers what it already did
-- under that key and replays the answer instead of doing it twice.
CREATE TABLE IF NOT EXISTS idempotency_key (
  -- The caller's own key. Opaque to us — a UUID from the MCP door — and never
  -- interpreted, only compared.
  key         TEXT NOT NULL,

  -- 'human:<id>' or 'agent:<id>'. Part of the primary key, not a column beside
  -- it: two callers that both generate "1" must not be able to read, replay, or
  -- block each other's writes, and a shared key space would make one agent's
  -- response readable by another principal that guessed its key.
  principal   TEXT NOT NULL,

  -- sha256 of method + path + raw body. A key reused with different content is
  -- a caller bug, and replaying the first response would silently drop the
  -- second change, so the fingerprint is what turns that into a 409 rather than
  -- into lost data.
  fingerprint TEXT NOT NULL,

  -- NULL while the first attempt is still running. That is the in-flight marker
  -- a concurrent duplicate collides with — the row is inserted BEFORE the work,
  -- so two simultaneous retries cannot both pass the check and both write.
  status      INTEGER,
  body        TEXT,
  content_type TEXT,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY (principal, key)
);

-- Reaping only. Rows are worthless once no client would still be retrying, and
-- keeping them forever would make this table the fastest-growing one in the
-- schema — every create by every agent, permanently.
CREATE INDEX IF NOT EXISTS idx_idempotency_key_created
  ON idempotency_key(created_at);
