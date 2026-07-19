-- M3: per-member "last seen" marker for the notification bell.
--
-- Notifications are not stored — they ARE the activity log (003), read back as a
-- workspace feed. The only new state is how far each member has read: one row
-- per (user, workspace) holding the timestamp of their last look. Unread is then
-- "activity newer than this, by someone other than me", computed at read time.
--
-- This keeps the audit trail the single source of truth (no notification rows to
-- keep in step with it) and makes "mark all read" one UPSERT rather than a
-- fan-out write per entry.

CREATE TABLE IF NOT EXISTS notification_seen (
  user_id      TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, workspace_id)
);
