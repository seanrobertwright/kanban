-- Comment resolution and @mentions.
--
-- Two small pieces of thread machinery, one migration, because both are facts
-- about a comment and neither touches its words: resolution marks a thread
-- handled, a mention names who should read it.

ALTER TABLE comment
  -- When the comment was marked handled, or NULL for an open remark. A
  -- timestamp rather than a boolean because "resolved" without "when" answers
  -- half the question a reader asks of a settled thread — and the boolean is
  -- free: resolved IS resolved_at IS NOT NULL.
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ,
  -- Who resolved it. TEXT with no foreign key, author_id's reasoning exactly
  -- (005): the record must outlive the account, and only humans resolve — an
  -- agent reports, it does not moderate — so no type column rides beside it.
  ADD COLUMN IF NOT EXISTS resolved_by TEXT;

-- Who a comment names. Written by the server when a comment is created or
-- edited — the body is parsed against the workspace's member names, so a row
-- here is a *derived* fact, recomputed on every edit rather than trusted from
-- any client. ON DELETE CASCADE: a mention is meaningless without its comment.
--
-- user_id carries no foreign key, author_id's reasoning again — but unlike the
-- author, a mention of a departed member is swept naturally: the parse that
-- recomputes rows only ever matches current members.
CREATE TABLE IF NOT EXISTS comment_mention (
  comment_id INTEGER NOT NULL REFERENCES comment(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  PRIMARY KEY (comment_id, user_id)
);

-- The bell's question: "does this comment mention me?" — asked per notification
-- row, keyed by the reader.
CREATE INDEX IF NOT EXISTS idx_comment_mention_user
  ON comment_mention(user_id);
