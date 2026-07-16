-- M1: subtasks — somewhere for an agent to put the pieces.
--
-- The last M1 feature, and PRD §9 states its purpose in one line: "an agent
-- decomposing work needs somewhere to put the pieces". §7.1 makes create_subtask
-- an agent tool, and §11's success criterion is an agent completing "a triage or
-- grooming task end-to-end" — grooming *is* decomposition.
--
-- A subtask is a task. That is the whole schema, and two facts force it.
--
-- The first is M2. Every tool in §7.1 — claim_task, move_task, update_task,
-- comment_on_task — takes a task. A separate `subtask` table would let an agent
-- decompose work into pieces it could not then be assigned, claim, move, or
-- report on, which defeats the point of decomposing it. Self-referencing task
-- means every one of those tools works on a piece the day it works on a task,
-- with no second implementation and no second RBAC path to keep in step. This is
-- §7.1's own argument for why both agent doors sit on one tool layer, applied one
-- level down.
--
-- The second is features.md, which scores "Subtasks or child items" (decompose
-- work into smaller nested units) and "Checklists" (lightweight itemized
-- completion lists) as *separate* criteria. M1 chose the former and §9 defers the
-- latter by name. A title-and-a-checkbox child table is the checklist — so it
-- would build the deferred criterion and skip the chosen one.
--
-- No migration of data: every existing task is top-level, which is what NULL
-- means below. Contrast 006, where the backfill was implicit but real.

ALTER TABLE task
  ADD COLUMN IF NOT EXISTS parent_id INTEGER
    -- CASCADE, and this is the third distinct call this schema has made on the
    -- same question — worth naming all three, because the rule is now visible.
    --
    --   activity_log.task_id: no FK. The record of a deletion must outlive it.
    --   task.assignee_id:     SET NULL. Deleting a person must not delete work.
    --   task.parent_id:       CASCADE. The pieces ARE the parent's work.
    --
    -- What decides it is whether the child is *about* the parent or merely
    -- *points at* it. A subtask has no meaning without the thing it decomposes:
    -- "add session middleware" is not work anyone would keep after "build auth"
    -- is gone. That is comment.task_id's reasoning (005) exactly, and it lands
    -- the same way.
    --
    -- But the CASCADE is not what runs when someone clicks delete. It would take
    -- the pieces silently, without one activity_log row to say where they went —
    -- which is the trap 007's board_column delete guard exists for. deleteTask
    -- logs each subtask before removing the parent; the CASCADE is the backstop
    -- for workspace deletion, which is the only thing that should reach it. See
    -- features/tasks/server/repository.ts.
    REFERENCES task(id) ON DELETE CASCADE;

-- Serves two queries by name, which is the bar 004 and 006 set for an index.
--
-- "this parent's subtasks" — the dialog's read, and deleteTask's, which must find
-- the pieces it is about to log. And the sibling position shuffles below, which
-- filter on parent_id and order by position.
--
-- Partial, for 004's reason: the overwhelming majority of tasks are top-level, no
-- query asks for "tasks with no parent" through this index (the board reads by
-- column, and idx_task_column already serves it), and a partial index keeps the
-- common row out of it entirely.
CREATE INDEX IF NOT EXISTS idx_task_parent
  ON task(parent_id, position) WHERE parent_id IS NOT NULL;

-- `position` now means: this task's order among the tasks it renders beside.
--
-- That is a generalization rather than a change, and it needs no backfill — for
-- a top-level task the siblings are its column's other top-level tasks, which is
-- what position has always meant. The scope is (column_id, parent_id): a
-- subtask's position orders it among its parent's other pieces in the same
-- column.
--
-- The alternative — subtasks sharing the column's one position space — is broken,
-- and not subtly enough to leave to a comment. The board renders only top-level
-- tasks, so it sends the index it can see, while the server shifts every row in
-- the column. Take a column holding A(0), B(1) and hidden subtask s(2). Drag A
-- below B: the client sends position 1, the server shifts B to 2 and s to 3 and
-- writes A at 1 — and the board still renders A, B. The drag silently does
-- nothing. Every position query in the tasks repository therefore carries
-- `parent_id IS NOT DISTINCT FROM` (not `=`, which is never true for NULL).

-- Depth is 1: a subtask cannot have subtasks.
--
-- Arbitrary nesting buys cycles to prevent, recursive reads to bound, and a UI
-- nobody has asked for. One level is what decomposition needs and what Jira
-- settled on. Enforced in the repository — it needs to read the parent's own
-- parent, which a CHECK cannot see (004's shape, and refused for 004's reason:
-- the alternative is denormalizing, which M0 rejected by name).
--
-- The trigger below is what makes that repository check an invariant rather than
-- a suggestion, and the reasoning is worth following because it is the *opposite*
-- of the one 007's column guard reached.
--
-- That guard needed FOR UPDATE: it counted tasks, and a count changes under it,
-- so check-then-act was a real race. Here the check reads parent.parent_id — and
-- because that value can never change once written, the answer is permanent the
-- moment it is read. No lock, no race, nothing to hold open. Immutability is
-- doing the work a lock would otherwise have to.
--
-- Which means the depth invariant rests *entirely* on parent_id never changing —
-- a fact that lives nowhere near the code that depends on it. So it is enforced
-- by the database rather than by convention, which is 003's rule for the same
-- situation. Someone adding re-parenting to updateTask has to come here and break
-- this trigger on purpose, and the exception tells them what they are buying: a
-- lock and a cycle check, for a feature nothing in M1 or M2 needs.
--
-- Re-parenting is the deliberate casualty. Promoting a subtask to a task, or
-- moving a piece under a different parent, is a real want and a famously awkward
-- one; it is not on any milestone, and it costs the paragraph above to allow.
CREATE OR REPLACE FUNCTION task_parent_immutable() RETURNS trigger AS $$
BEGIN
  -- IS DISTINCT FROM, not <>: both sides are usually NULL, and NULL <> NULL is
  -- NULL, so `<>` would let every ordinary update fall through the check.
  IF NEW.parent_id IS DISTINCT FROM OLD.parent_id THEN
    RAISE EXCEPTION 'task.parent_id is immutable; re-parenting is not supported'
      USING HINT = 'Allowing it requires a lock and a cycle check — see 008.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_task_parent_immutable ON task;
CREATE TRIGGER trg_task_parent_immutable
  BEFORE UPDATE ON task
  FOR EACH ROW EXECUTE FUNCTION task_parent_immutable();

-- Not enforceable in the schema, and stated here for the reason 004 and 007 state
-- theirs:
--
--   INVARIANT: a subtask is on the same board as its parent.
--
-- The FK proves the parent is a task *somewhere*. Without this, a piece of "build
-- auth" could sit in another board's column — or, once a user belongs to two
-- workspaces, across the tenancy boundary itself. Proving it means joining both
-- sides through board_column to board, which no CHECK can see.
--
-- This is moveTask's existing target.boardId !== boardId check, one level out, and
-- it exists for the same reason: an authz check proves the caller may touch each
-- side, never that the two sides belong together. See assertSameBoard() in
-- features/tasks/server/repository.ts.
--
-- Same board rather than same column, deliberately: the whole point of a subtask
-- having a status is that a piece flows through the workflow independently of the
-- thing it decomposes. "build auth" sits in Todo while "add login route" is in
-- Doing — that is decomposition working, not a violation.
