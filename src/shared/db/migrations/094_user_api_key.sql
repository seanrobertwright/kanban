-- Phase 2 of the CLI (Door 4): the personal API key — a human credential for
-- programmatic callers.
--
-- The agent key (009) authenticates a *bot* principal; everything it does is
-- attributed to the agent. A person driving the CLI wants the opposite: actions
-- recorded as theirs. This table is the credential that makes that possible
-- without dragging a browser cookie into a terminal.
--
-- The shape deliberately mirrors `agent.token_hash`: only the sha256 of the
-- token is stored, because the token is 256 bits of entropy, not a password —
-- there is nothing to brute-force, so a KDF would buy latency and no safety.
-- The raw token exists exactly once, at mint, prefixed `kbu_` so a leaked one
-- is greppable in logs and config files (the human sibling of `kbn_`).
--
-- A key belongs to a user, not a workspace: the human's workspace roles are
-- looked up per request exactly as they are for a cookie session, so a key
-- grants what its owner has — nothing more, and automatically less when their
-- membership shrinks. CASCADE for the usual reason: a departed user's keys must
-- not outlive the account they could act as.
--
-- Revocation is DELETE, as it is for agents: a dead credential is a missing
-- row, not a flag every auth lookup has to remember to check.

CREATE TABLE IF NOT EXISTS user_api_key (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  -- What the key is for ("laptop CLI", "CI"), so the owner can tell which of
  -- their keys is which when deciding what to revoke.
  name         TEXT NOT NULL,
  token_hash   TEXT NOT NULL UNIQUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Touched at most once an hour by the auth path (user-key.ts), so "unused
  -- since May" is answerable without a write per request.
  last_used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS user_api_key_user_idx ON user_api_key (user_id);
