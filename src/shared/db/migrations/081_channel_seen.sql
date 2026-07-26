-- Chat unread markers (3.7): the reader's last look at a channel, one row per
-- (channel, user). notification_seen's shape, scoped to a channel instead of a
-- workspace — "unread" is derived by comparing message created_at against this,
-- so no per-message read receipts are stored. Absent row = never looked.
CREATE TABLE channel_seen (
  channel_id INTEGER NOT NULL REFERENCES channel(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, user_id)
);
