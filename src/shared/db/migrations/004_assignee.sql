-- M1: task assignees.
--
-- PRD §9 calls this "the slot an agent will later occupy", and §8 is more
-- specific: assignee_id and agent_id are peers on task, exactly one set. M1
-- builds the human half; M2 adds agent_id beside it and the CHECK that keeps
-- them exclusive. Nothing here should have to move when that lands.

ALTER TABLE task
  ADD COLUMN IF NOT EXISTS assignee_id TEXT
    -- SET NULL, emphatically not CASCADE: the assignee is a person, and
    -- deleting a person must not delete the work assigned to them. CASCADE here
    -- would turn "remove a departing employee" into "silently destroy their
    -- board". Unassigned is the honest outcome — the task outlives the assignee.
    --
    -- Note this is the opposite call from activity_log.actor_id, which carries
    -- no FK at all (003). The difference is current state vs. history: an
    -- assignee is a live pointer that must resolve to a real user, whereas an
    -- audit row records who acted at a moment that has already passed and must
    -- survive them. Same column type, opposite requirements.
    REFERENCES "user"(id) ON DELETE SET NULL;

-- Partial: the overwhelming majority of rows are unassigned, and no query asks
-- for "tasks with no assignee" via this index — the board reads by column. What
-- needs the index is "this person's tasks", which M3's workload view (and M2's
-- agent capacity accounting) will ask per user.
CREATE INDEX IF NOT EXISTS idx_task_assignee
  ON task(assignee_id) WHERE assignee_id IS NOT NULL;

-- Not enforceable in the schema, and deliberately so:
--
--   INVARIANT: a task's assignee is a member of the task's workspace.
--
-- The FK above only proves the user exists *somewhere*. Proving membership
-- means joining task -> board_column -> board -> workspace_member, which no
-- CHECK constraint can do (they see one row). The alternatives were a trigger,
-- or denormalizing workspace_id onto task so a composite FK could reach
-- workspace_member — and M0 rejected that denormalization by name, because it
-- lets a task's workspace drift from its column's board.
--
-- So the check lives in the repository, next to the RBAC checks, which are
-- enforced there for the same reason. See assertAssignable() in
-- features/tasks/server/repository.ts, and the cleanup in members.ts that keeps
-- the invariant true when someone leaves a workspace.
