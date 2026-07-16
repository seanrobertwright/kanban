-- M2: the agent principal — Door 2's identity.
--
-- PRD §7.1 exposes one tool layer through two doors, and §8 makes the agent a
-- first-class principal: `agent ──> workspace`, "the same RBAC, claiming, approval
-- policy, and audit trail as a native one". This is that row. An external coding
-- agent authenticates as one of these and is subject to the same checks a human
-- is — it is not a privileged back door, which §7.1 says is the whole point.
--
-- The role lives ON the agent row, where a human's lives in workspace_member. The
-- asymmetry is the schema stating a fact about the two: a person belongs to many
-- workspaces with a different role in each, so their role is an edge; an agent
-- belongs to exactly one workspace (§8's arrow is single-headed), so its role is
-- an attribute. A membership table for a single membership would be a join to
-- nowhere.
--
-- workspace_id is TEXT to match workspace(id) (001), and CASCADE for the reason
-- everything under a workspace cascades: deleting a workspace must take its agents
-- with it, or their tokens outlive the thing they could act on.

DO $$ BEGIN
  -- native = an agent we host and drive (Door 1, deferred); external = one the
  -- customer runs and points at us over MCP (Door 2, this cut). §8: "that is the
  -- only difference" — a native agent carries a model and prompt, an external one
  -- a credential, and everything downstream treats them identically. The column
  -- exists now so Door 1 needs no migration, only rows of a kind already legal.
  CREATE TYPE agent_kind AS ENUM ('native', 'external');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS agent (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  image        TEXT,
  -- Reuses workspace_role (001), so an agent gates through the exact ROLE_RANK a
  -- human does — a viewer agent can be handed a task but not move it, an admin
  -- agent can delete a column. RBAC parity is a single shared enum, not two.
  role         workspace_role NOT NULL DEFAULT 'member',
  kind         agent_kind NOT NULL DEFAULT 'external',
  -- The credential, hashed — sha256 of the bearer token the MCP server presents.
  -- Only the hash is stored, so a database read cannot recover a working key; the
  -- raw token exists once, in the output of scripts/create-agent.mjs. UNIQUE so a
  -- presented token resolves to at most one agent.
  token_hash   TEXT NOT NULL UNIQUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The agent's actions land in activity_log.actor_id with actor_type = 'agent',
-- and that column still carries NO foreign key — 003's rule, that the record of
-- an action outlives its actor, holds for agents exactly as for users. Deleting
-- an agent leaves its history readable; the feed resolves the name by LEFT JOIN
-- and tolerates its absence (features/activity/server/repository.ts).

-- Serves the auth hot path — every agent request resolves its principal by
-- token_hash — but the UNIQUE constraint already indexes that. This one serves
-- the other read: "the agents of this workspace", which the /api/agent/me handler
-- and any future management UI ask by name.
CREATE INDEX IF NOT EXISTS idx_agent_workspace ON agent(workspace_id);
