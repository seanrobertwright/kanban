-- Phase 3 native chat. Private channels are visible only through
-- channel_member; public workspace channels are readable by workspace viewers.
CREATE TABLE channel (
  id SERIAL PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (btrim(name) <> ''),
  is_private BOOLEAN NOT NULL DEFAULT false,
  created_by TEXT NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, name)
);
CREATE TABLE channel_member (
  channel_id INTEGER NOT NULL REFERENCES channel(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  PRIMARY KEY (channel_id, user_id)
);
CREATE TABLE chat_message (
  id BIGSERIAL PRIMARY KEY,
  channel_id INTEGER NOT NULL REFERENCES channel(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  body TEXT NOT NULL CHECK (btrim(body) <> ''),
  parent_id BIGINT REFERENCES chat_message(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_chat_message_channel ON chat_message(channel_id, created_at DESC);
