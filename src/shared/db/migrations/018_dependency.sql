-- M3 (Planning & Views): task dependencies — "this cannot start until that is done".
--
-- One directed edge, and its direction is the one real decision here:
--
--   task_dependency(task_id, depends_on_task_id)
--     reads "task_id is blocked by depends_on_task_id"
--     equivalently "task_id depends on depends_on_task_id"
--     equivalently depends_on_task_id must finish before task_id.
--
-- The blocked task is the subject (task_id), so a task's own row set is exactly
-- its blockers — which is the read the dialog and the card's count both want, and
-- what makes the primary key (task_id, ...) serve them with no extra index. The
-- reverse read ("what does THIS unblock") is the recursive walk below and gets
-- its own index.
--
-- Three invariants, and where each is enforced follows the same rule 004/007/008
-- reached: in the schema when a CHECK can see the whole answer, in the repository
-- when it cannot.
--
-- 1. No self-dependency — a CHECK, because both columns are on the row.
-- 2. Same board — NOT here. A dependency between tasks on two different boards
--    (or, once a user is in two workspaces, across the tenancy boundary) is
--    meaningless, but proving two tasks share a board means joining both through
--    board_column, which no CHECK can see. This is moveTask's and 008's own
--    check, one relation over — see assertSameBoard-shaped logic in
--    features/dependencies/server/repository.ts.
-- 3. No cycles — NOT here, and this is the interesting one. A CHECK cannot
--    traverse a graph, and a lock-free trigger cannot make the traversal a race-
--    free invariant the way 008's depth check is. 008 needed no lock because
--    parent_id is immutable: read it once and the answer is permanent. Dependency
--    edges are added freely, so two concurrent inserts can each pass a "would
--    this cycle?" check and then jointly form a cycle. Locking the two endpoint
--    tasks is not enough — the cycle A->B ~> C->A, formed by concurrently
--    inserting B->C and C->A, shares no endpoint task between the two writes. The
--    only point that serializes every write that could interact is the board, so
--    addDependency takes a board-scoped advisory lock before the reachability CTE
--    runs. See the repository.
--
-- No activity_log rows, and that is 017's decision reached again for a different
-- shape. Every task-state mutation logs (M1's criterion), but a dependency is not
-- state either task *holds* — it is a relationship *between* two tasks, and
-- TaskSnapshot is a picture of one task. There is no field in it for "blocked by
-- #42", so a log row could neither carry the change nor let undo replay it
-- without a new bidirectional action and an edge-recreating undo model that no
-- milestone asks for. Logging it would be inventing that machinery to write a row
-- nothing can read back. The edge lives in this table; the day a milestone wants
-- "who added this blocker and when", created_at is already here to build on.

CREATE TABLE IF NOT EXISTS task_dependency (
  task_id            INTEGER NOT NULL REFERENCES task(id) ON DELETE CASCADE,
  depends_on_task_id INTEGER NOT NULL REFERENCES task(id) ON DELETE CASCADE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, depends_on_task_id),
  -- A task blocking itself is a zero-length cycle. The CHECK is the schema half
  -- of the no-cycles invariant — the part that fits on one row, so it lives here
  -- rather than in the repository's reachability walk that handles the rest.
  CONSTRAINT task_no_self_dependency CHECK (task_id <> depends_on_task_id)
);

-- The PK (task_id, depends_on_task_id) already serves "my blockers", the ON
-- CONFLICT dedupe, and the forward cycle walk (which keys on task_id). This index
-- serves the other direction: "which tasks depend on THIS one", which the
-- candidate query walks to exclude tasks that would cycle, and the FK's cascade
-- uses when a depended-on task is deleted.
CREATE INDEX IF NOT EXISTS idx_task_dependency_depends_on
  ON task_dependency(depends_on_task_id);
