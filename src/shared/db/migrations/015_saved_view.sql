-- M3: saved views — a member's private, named filter + lens.
--
-- Personal, not workspace vocabulary (contrast 007's label): a saved view is one
-- person's way of looking at a board, so it is scoped to (workspace_id, user_id)
-- and never shown to anyone else. That is also why nothing here writes to the
-- activity log — saving a filter is a UI preference, not a change to the board
-- that another member (or an agent) needs to see recorded.
--
-- filter is JSONB rather than columns because its shape is the client's
-- BoardFilter and grows with the filter UI (a new facet is a new key, not a
-- migration). The API validates the shape on the way in; the database only
-- promises it is an object.

CREATE TABLE IF NOT EXISTS saved_view (
  id           SERIAL PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  view_mode    TEXT NOT NULL DEFAULT 'board'
                 CHECK (view_mode IN ('board', 'list', 'calendar')),
  filter       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One name per person per workspace, case-insensitively — the same lower()
-- discipline 007 uses, so "Mine" and "mine" cannot both exist and "save" can
-- mean "overwrite the one I already have".
CREATE UNIQUE INDEX IF NOT EXISTS saved_view_name_unique
  ON saved_view (workspace_id, user_id, lower(name));

-- The list query is always "this user's views in this workspace, by name".
CREATE INDEX IF NOT EXISTS saved_view_owner_idx
  ON saved_view (workspace_id, user_id);
