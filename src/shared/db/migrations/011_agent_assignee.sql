-- M2: the agent assignee — the peer 004 reserved a place for.
--
-- 004 built the human half of assignment and named this migration in advance:
-- "assignee_id and agent_id are peers on task, exactly one set. M1 builds the
-- human half; M2 adds agent_id beside it and the CHECK that keeps them exclusive.
-- Nothing here should have to move when that lands." This is that, and nothing
-- there moved.
--
-- It is the schema-level statement of the whole wedge (PRD §8): an agent can be
-- handed a task the same way a person can, and the board tracks human and agent
-- capacity as peers. §4.3's first requirement — "an agent has an assignee slot" —
-- is this column. And it is the trigger seam the rest of M2 hangs off: §8 and the
-- task.assigned essay both say "at M2 assigning a task to an agent is what
-- triggers a run." The run itself (Door 1) is later work; this is the slot the
-- assignment lands in and the event that will start it.
--
-- Additive, deliberately. assignee_id stays exactly as 004 wrote it — same FK,
-- same index, same SET NULL — and the app layer unifies the two columns into one
-- `assignee: Actor | null` above the database (task-row.ts, the same shape 010's
-- claimedBy took). So the churn of the change is all in TypeScript; the schema
-- only gains a column and an invariant.
ALTER TABLE task
  ADD COLUMN IF NOT EXISTS agent_id TEXT
    -- ON DELETE SET NULL, exactly as assignee_id (004), and for the identical
    -- reason: an assignee is a live pointer that must resolve to a real principal,
    -- and deleting the principal must not delete the work. Deleting an agent
    -- unassigns its tasks; it does not destroy them. This is the *opposite* of the
    -- agent's OTHER column, claimed_by (010), which carries no FK because it is
    -- polymorphic — agent_id points at one table and can be a real foreign key,
    -- where claimed_by points at user OR agent and cannot.
    REFERENCES agent(id) ON DELETE SET NULL;

-- Exactly one, at most. The peer relationship 004 and §8 describe, made an
-- invariant the database holds rather than a rule three writers must remember: a
-- task is assigned to a person, or to an agent, or to no one — never to both. The
-- app layer keeps it true by clearing one column whenever it sets the other
-- (setAssignee, features/tasks/server/repository.ts), and this CHECK is what makes
-- that a guarantee instead of a habit. Both-null is the ordinary unassigned state,
-- so the constraint bounds the pair from above only.
DO $$ BEGIN
  ALTER TABLE task ADD CONSTRAINT task_one_assignee CHECK (
    NOT (assignee_id IS NOT NULL AND agent_id IS NOT NULL)
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Partial, and the mirror of 004's idx_task_assignee for the same reasons: almost
-- no rows carry an agent, and no query asks for "tasks with no agent" — the board
-- reads by column. What names this index is "this agent's tasks", which is agent
-- capacity accounting: §4.3.5's planning that "counts human and agent capacity as
-- peers", and the very read 009's idx_agent_workspace comment anticipated on the
-- other side of the join.
CREATE INDEX IF NOT EXISTS idx_task_agent
  ON task(agent_id) WHERE agent_id IS NOT NULL;

-- Not enforceable in the schema, and stated here as 004 stated its twin:
--
--   INVARIANT: a task's agent assignee is an agent of the task's workspace.
--
-- The FK proves the agent exists somewhere; it does not prove it belongs to this
-- task's workspace. An agent belongs to exactly one (009), so the check is one
-- lookup — agent WHERE id = $1 AND workspace_id = $2 — but it still needs the
-- task's workspace, which means a join no CHECK can see. So it lives in the
-- repository beside 004's assertAssignable, which now proves membership for a
-- human OR an agent depending on the assignee's kind. Same invariant, same place,
-- one function.
