-- Threaded replies: a comment can answer another comment.
--
-- One level deep, subtasks' rule (008) and for its reason: a reply-to-a-reply
-- reads as an ever-narrowing column nobody wants, and a flat "reply under the
-- remark it answers" is the whole of what a task discussion needs. Depth is held
-- in the repository, not a trigger — a comment's parent is set at creation and
-- never changes (there is no re-parent path), so the depth-1 check reads an
-- immutable value and needs no lock, exactly assertDecomposable's reasoning.
ALTER TABLE comment
  -- CASCADE: a reply is meaningless without the remark it answers, so deleting a
  -- parent takes its replies — the same call 005 makes for a comment and its
  -- task. The record that they were deleted still lands in activity_log.
  ADD COLUMN IF NOT EXISTS parent_id INTEGER REFERENCES comment(id) ON DELETE CASCADE;

-- The read that wants this — "the replies under this comment" — filters by
-- parent_id. Partial, 026's reasoning: most comments are top-level, so the index
-- covers only the rows that are replies.
CREATE INDEX IF NOT EXISTS idx_comment_parent
  ON comment(parent_id) WHERE parent_id IS NOT NULL;
