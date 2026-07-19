-- M3 (Core Work Items): task attachments — a file on a task.
--
-- The one real decision is the split: metadata lives here, the bytes live in an
-- S3-compatible object store (features/attachments/server/storage.ts). This row
-- is the source of truth for what exists and who may see it; the object is only
-- content, addressed by `key`. Postgres is where authz and listing happen — a
-- query no object store answers well — and the store is where large, opaque
-- bytes belong, off the row and out of the backups a bytea column would bloat.
--
-- The seam that split creates, and the one thing to keep in mind: a CASCADE
-- reaches rows, never objects. Deleting a task takes its attachment rows with it,
-- but the objects those rows named are left in the bucket — an orphan the store
-- cannot know is dead. Explicit deleteAttachment removes the object first-hand;
-- the task-delete cascade cannot, so those objects leak until a reconciler sweeps
-- keys with no row (a documented follow-up, not a correctness bug — nothing in
-- the database dangles, only unreferenced bytes remain).
--
-- key is UNIQUE and opaque (tasks/<taskId>/<uuid>): the original filename is kept
-- in `name` for display and downloads, but never used as the object key, so two
-- files called report.pdf on one task cannot collide and a name with slashes or
-- spaces cannot escape its prefix.
--
-- uploaded_by SET NULL, not CASCADE: a departing member must not delete the files
-- they attached — that is task.assignee_id's rule (004), and for its reason. The
-- attachment outlives the account; the row simply forgets who added it.
--
-- No activity_log rows — 017's line for fine-grained content. An attachment is
-- content on a task like the description and the checklist, not a state change
-- TaskSnapshot carries; logging each upload would bury assignments and moves the
-- way logging each keystroke would.

CREATE TABLE IF NOT EXISTS attachment (
  id           SERIAL PRIMARY KEY,
  task_id      INTEGER NOT NULL REFERENCES task(id) ON DELETE CASCADE,
  key          TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size         BIGINT NOT NULL,
  uploaded_by  TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The one read is "this task's files, newest first"; the delete cascades from
-- task. Newest-first because an attachment list is a small feed — the file you
-- just added is the one you are looking for.
CREATE INDEX IF NOT EXISTS idx_attachment_task
  ON attachment(task_id, created_at DESC);
