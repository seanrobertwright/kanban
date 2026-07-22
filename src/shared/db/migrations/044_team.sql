-- Teams + Scaled Agile / SAFe (044) — the layer this app was missing to express
-- scaled agile end to end.
--
-- SAFe stacks four layers: Portfolio → Program(ART) → Team → work. Three already
-- exist here — the workspace Portfolio view, the Program/initiative grouping
-- (040, the ART layer that gathers projects delivering together), and the Board
-- (a project) with its Epics/Milestones/Sprints/Tasks. The missing layer is the
-- Team: the group of people an ART is made of. This migration adds it and lets a
-- board name the team that owns it, so the Scaled Agile view can render the whole
-- cake: Portfolio (totals) → ARTs (programs) → Teams → Boards.

-- A team is workspace-scoped (like a program, 040, and for the same reason: the
-- people it groups all live at the workspace level — labels' vocabulary rule).
CREATE TABLE IF NOT EXISTS team (
  id SERIAL PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (btrim(name) <> ''),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_team_workspace ON team(workspace_id);

-- Team membership. CASCADE on both sides: a deleted team takes its rows, a
-- deleted user leaves every team. That a user is a *workspace* member is a fact
-- the FKs cannot express (membership lives in workspace_member), so the
-- repository proves it before inserting — capacity's member guard (041).
CREATE TABLE IF NOT EXISTS team_member (
  team_id INTEGER NOT NULL REFERENCES team(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, user_id)
);

-- A board is owned by at most one team. SET NULL, program_id's shape (040):
-- deleting a team un-owns its boards, it does not take the projects with it,
-- so deletion can be gated at admin without a board-loss blast radius.
ALTER TABLE board
  ADD COLUMN IF NOT EXISTS team_id INTEGER
    REFERENCES team(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_board_team
  ON board(team_id) WHERE team_id IS NOT NULL;
