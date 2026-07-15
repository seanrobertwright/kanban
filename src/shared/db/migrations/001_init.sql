-- M0: workspace tenancy.
--
-- Runs AFTER the better-auth CLI has created "user"/session/account/verification
-- (npm run db:auth), because workspace_member references "user"(id).
--
-- Renames from the SQLite schema:
--   columns -> board_column   ("column" is reserved in Postgres; "columns"
--                              shadows information_schema.columns)
--   tasks   -> task

CREATE TABLE IF NOT EXISTS workspace (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  slug       TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  CREATE TYPE workspace_role AS ENUM ('owner', 'admin', 'member', 'viewer');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS workspace_member (
  workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  role         workspace_role NOT NULL DEFAULT 'member',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_member_user ON workspace_member(user_id);

CREATE TABLE IF NOT EXISTS board (
  id           SERIAL PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  position     INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_board_workspace ON board(workspace_id, position);

CREATE TABLE IF NOT EXISTS board_column (
  id         SERIAL PRIMARY KEY,
  board_id   INTEGER NOT NULL REFERENCES board(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  position   INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_board_column_board ON board_column(board_id, position);

CREATE TABLE IF NOT EXISTS task (
  id          SERIAL PRIMARY KEY,
  column_id   INTEGER NOT NULL REFERENCES board_column(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  position    INTEGER NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_column ON task(column_id, position);
