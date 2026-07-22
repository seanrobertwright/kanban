-- Programs / initiatives (040) — the grouping one level above a board.
--
-- A board is a project; a Program groups several projects into an initiative
-- ("Mobile", "2026 Platform") so a workspace can be read above the project line.
-- It is the hierarchy the feature model calls "Program/initiative hierarchy":
-- Program → Board(project) → Epic → Milestone → Task.
--
-- Workspace-scoped, not board-scoped: a program spans boards, so it belongs to
-- the workspace the way a label's vocabulary does (007) — the level at which the
-- boards it groups all live.
CREATE TABLE IF NOT EXISTS program (
  id SERIAL PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (btrim(name) <> ''),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_program_workspace ON program(workspace_id);

-- A board files under at most one program. SET NULL, milestone_id's shape (026):
-- deleting a program un-groups its boards, it does not take the projects with it,
-- which is why the program repository can gate deletion at admin without a
-- board-loss blast radius. Nullable — an ungrouped board is the default.
ALTER TABLE board
  ADD COLUMN IF NOT EXISTS program_id INTEGER
    REFERENCES program(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_board_program
  ON board(program_id) WHERE program_id IS NOT NULL;
