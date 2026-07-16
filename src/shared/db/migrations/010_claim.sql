-- M2: task claiming — the exclusive hold that keeps two agents off one task.
--
-- PRD §8 draws it on the task directly ("claimed_by / claimed_at — exclusive
-- hold; prevents collisions") and §4.3 says what it is for: "an agent can be
-- assigned a task the same way a person can, and claims it exclusively while
-- working." Claiming is not assignment. Assignment (004) says whose work it is,
-- set by a human; a claim is the working lock the actor itself takes when it
-- starts, and drops when it stops. The two are orthogonal axes, which is why this
-- is its own set of columns rather than a flag on assignee_id.
--
-- It is the one piece of M2 that could not wait for the rest. Q6 defers *agent
-- coordination* — how agents negotiate, hand off, avoid duplicating work — to M5,
-- but the collision it guards against is not an M5 problem: 009 already shipped
-- the MCP door, so two external agents can act on one board *today*, and the
-- moment they do they will both grab the same task. §8 calls this "cheap
-- insurance, paid now": a day here, a migration-on-live-data later.

-- claimed_by is polymorphic — a user id OR an agent id — so it carries no foreign
-- key, and it is worth being exact about why, because the same shape has meant
-- three different things across this schema now:
--
--   activity_log.actor_id: no FK because history must OUTLIVE its actor.
--   task.assignee_id:      FK + SET NULL because it is a live pointer to a user.
--   task.claimed_by:       no FK because it points at a user OR an agent — two
--                          tables, and no single REFERENCES can reach both.
--
-- So it lands on actor_id's spelling (unconstrained TEXT + a *_type discriminator)
-- for assignee_id's reason (it is current state, a live pointer, not history).
-- That difference has a consequence the other two make explicit: because it is
-- state and not a record, a claim by someone who has left is stale and must be
-- cleared — which is assignee_id's rule (unassignFromWorkspace), not actor_id's.
-- removeMember releases a departing member's claims in the same transaction it
-- drops their membership (releaseClaimsOf, features/tasks/server/repository.ts).
-- An agent's claims need no such sweep: an agent belongs to one workspace (009)
-- and is only ever deleted by that workspace's deletion, which CASCADEs the tasks
-- away with it.
ALTER TABLE task
  ADD COLUMN IF NOT EXISTS claimed_by TEXT,
  -- Reuses the actor_type enum (003), exactly as comment.author_type did (005):
  -- the discriminator that says which table claimed_by points at is the same
  -- 'human' | 'agent' distinction the log and the comment thread already draw. A
  -- claim's holder IS an actor, so it is stored actor-shaped.
  ADD COLUMN IF NOT EXISTS claimed_by_type actor_type,
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;

-- All three move together, and the database says so rather than trusting three
-- call sites to. A claim is a single fact — who holds it, and since when — split
-- across three columns only because SQL has no better shape for a nullable
-- polymorphic pointer. So "claimed" means all three set and "free" means all
-- three null, and no partial row (a holder with no timestamp, a type with no id)
-- is expressible. claimTask sets the three together and releaseTask nulls them
-- together; this is what makes that a guarantee instead of a habit.
DO $$ BEGIN
  ALTER TABLE task ADD CONSTRAINT task_claim_coherent CHECK (
    (claimed_by IS NULL) = (claimed_by_type IS NULL)
    AND (claimed_by IS NULL) = (claimed_at IS NULL)
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- No index, deliberately, and by the bar 004 and 008 set: an index earns its keep
-- when a query names the column it leads with. Nothing reads tasks BY claim yet —
-- the board reads by column, get_task by id, and claimTask locates its one row by
-- primary key. releaseClaimsOf scans a workspace's tasks by claimed_by, but that
-- runs only when a member is removed (rare) and against one workspace's rows, so a
-- sequential scan is the right cost. M5's coordination work — "what is this agent
-- holding right now" — is the query that will name it; build the index then,
-- when its shape is known, not now on a guess.
