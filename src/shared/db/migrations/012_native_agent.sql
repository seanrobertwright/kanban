-- M2: the native agent — Door 1's identity, the fields §8 reserved for it.
--
-- 009 built the agent principal and shipped the `kind` enum ('native' |
-- 'external') "so Door 1 needs no migration, only rows of a kind already legal".
-- That was half right: the *discriminator* needed no migration, but the columns
-- a native agent carries and an external one does not still had to land. This is
-- them. PRD §8: an agent row holds "model + system prompt + tool allowlist
-- [native only], credential [external only], per-tool approval policy", and
-- "that is the only difference" — everything downstream treats the two alike.
--
-- So the shape of this migration is the shape of that sentence: add the
-- native-only fields, keep the external-only credential, and make the schema
-- state which kind must carry which — the CHECK below is "that is the only
-- difference" written as an invariant instead of a comment.

ALTER TABLE agent
  -- The two native-only fields. A native agent IS a model and a prompt the way
  -- an external one IS a credential — §8 draws them as peers of `token_hash`,
  -- and the CHECK at the bottom holds each kind to its own.
  ADD COLUMN IF NOT EXISTS model         TEXT,
  ADD COLUMN IF NOT EXISTS system_prompt TEXT,
  -- Which board tools this agent may reach for. NULL = all of them, which is the
  -- honest default: the tool layer (015) is the closed set, and an allowlist
  -- narrows it rather than opens it. A TEXT[] rather than a join table for the
  -- reason 007 made labels a table and this is not one — the vocabulary here is
  -- the tool names, fixed in code, not user data that grows or needs its own
  -- identity. Applies to native only; an external agent's tools are whatever its
  -- MCP client offers, which we do not gate here (its RBAC still gates the door).
  ADD COLUMN IF NOT EXISTS tool_allowlist TEXT[],
  -- The per-tool approval policy §7.4 gates on: a map of tool name -> tier
  -- ('auto' | 'changeset' | 'block'). JSONB rather than a table for the same
  -- reason as tool_allowlist — it is configuration keyed by the tool vocabulary,
  -- read whole on every run, never queried by key across rows. '{}' means "no
  -- overrides", and the gate (016) fills the gaps from a blast-radius default in
  -- code (§7.4: "gating is per-tool, defaulted by blast radius"), so an empty
  -- policy is a fully-defaulted agent, not an ungated one.
  ADD COLUMN IF NOT EXISTS approval_policy JSONB NOT NULL DEFAULT '{}';

-- token_hash was NOT NULL (009), which a native agent cannot satisfy: it presents
-- no bearer token because nothing external authenticates as it — the app drives
-- it in-process (Door 1). Drop the NOT NULL. The UNIQUE stays, and nullable +
-- UNIQUE is exactly right: Postgres treats every NULL as distinct, so many native
-- agents (all NULL) coexist while a presented external token still resolves to at
-- most one agent. No column added to carry "has no token" — NULL already says it.
ALTER TABLE agent ALTER COLUMN token_hash DROP NOT NULL;

-- "That is the only difference" (§8), enforced rather than trusted: an external
-- agent must carry a credential, a native one must carry a model. The database
-- refuses a row that is neither a real external agent (token, the thing an MCP
-- client presents) nor a real native one (model, the thing the loop drives). It
-- deliberately does NOT require system_prompt — a native agent with no prompt is
-- legal (it runs on the model's defaults), the way 009's agent needed no image.
-- Existing external rows pass unchanged: they have token_hash and always did.
DO $$ BEGIN
  ALTER TABLE agent ADD CONSTRAINT agent_kind_fields CHECK (
    (kind = 'external' AND token_hash IS NOT NULL)
    OR (kind = 'native' AND model IS NOT NULL)
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
