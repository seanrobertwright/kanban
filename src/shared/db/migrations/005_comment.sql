-- M1: comments — the agent's reporting channel.
--
-- PRD §9 names this "the agent's reporting channel", which is why it outranks
-- labels and due dates in the M1 order: M2's acceptance criterion #1 has an
-- agent "comment its reasoning" on each of twenty triaged bugs, and #3 has an
-- external agent "comment progress" over MCP. Both need somewhere to write, and
-- §7.1 makes comment_on_task one of the six board-mutation tools.
--
-- §8 gives comments their own table (task ──< comment) rather than folding them
-- into activity_log, and the split is the point rather than an accident of
-- drawing: the log is append-only history that outlives its subject, while a
-- comment is live content its author may edit or delete. Every comment mutation
-- still writes a log row, so the two relate as content and record — not as
-- duplicates of each other.

CREATE TABLE IF NOT EXISTS comment (
  -- SERIAL, where activity_log took BIGSERIAL. That table gets a row for every
  -- mutation in the workspace — including each of these — so it is strictly the
  -- higher-volume of the two, and buys int8 for headroom it can actually reach.
  -- Comments are things people and agents say; int is plenty, and it keeps the
  -- id a JS number rather than the string pg returns for int8.
  id          SERIAL PRIMARY KEY,

  -- CASCADE, the opposite call from activity_log.task_id, which carries no FK
  -- at all. The distinction is the one 004 draws between an assignee and an
  -- actor, one level up: history must outlive its subject, content must not. A
  -- comment is a remark *about* this task and means nothing detached from it, so
  -- deleting the task takes the thread with it. The record that the deletion
  -- happened survives in activity_log, which is where an audit reader looks.
  task_id     INTEGER NOT NULL REFERENCES task(id) ON DELETE CASCADE,

  -- Authorship is actor-shaped from the first row, exactly as activity_log's is
  -- and for the same reason: at M2 an agent authors comments beside people, and
  -- a user-only FK now would buy a migration then, on a table already holding
  -- data. actor_type already exists (003), so this costs one column today.
  --
  -- No foreign key, therefore — and none is wanted even for the human half. A
  -- comment is an utterance: a thing someone said at a moment that has passed,
  -- not a live pointer like task.assignee_id that must resolve to a real user.
  -- ON DELETE SET NULL would keep the remark and erase who made it, and
  -- authorship is the one part of a remark that cannot be re-derived; CASCADE
  -- would delete a departing employee's half of every discussion, silently
  -- rewriting conversations that other people's replies still answer. A dangling
  -- id is the honest outcome — the comment stands and the reader is told the
  -- author is gone. Safe because SERIAL never reuses ids, so this can never come
  -- to mean a different person.
  author_type actor_type NOT NULL,
  author_id   TEXT NOT NULL,

  -- A CHECK holds this one, unlike 004's membership invariant, because it needs
  -- to see only this row. An empty comment is not a comment, and btrim means
  -- whitespace does not smuggle one past.
  body        TEXT NOT NULL CHECK (length(btrim(body)) > 0),

  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- NULL means never edited — the flag the UI renders "(edited)" from. A DEFAULT
  -- now() here would make every comment born edited, and no later query could
  -- tell the difference.
  updated_at  TIMESTAMPTZ
);

-- (task_id, id) ascending, where idx_activity_log_task is DESC. The direction is
-- not a preference: an audit trail answers "what just happened?" and reads
-- newest-first, while a conversation reads oldest-first, because a reply printed
-- above the remark it answers is unreadable.
CREATE INDEX IF NOT EXISTS idx_comment_task ON comment(task_id, id);

-- Not enforceable in the schema, and deliberately so — the same shape of gap
-- 004 documents:
--
--   INVARIANT: a comment's author is a member of the task's workspace.
--
-- There is no FK here to lean on at all, so this is the *only* thing standing
-- between the table and a comment attributed to a stranger. Proving membership
-- means joining comment -> task -> board_column -> board -> workspace_member,
-- which no CHECK can see. It lives in the repository next to the RBAC checks,
-- which is where requireTaskRole already proves exactly this on the way in.
--
-- Unlike an assignee, this invariant is NOT re-enforced when a member is
-- removed: 004's cleanup clears their assignments, because an assignee is a live
-- claim on work in a workspace they can no longer see. A comment is not a claim,
-- it is a record of something said while they were there — and deleting a
-- departing member's remarks would tear holes in threads that replied to them.
-- The author reverts to a plain name and avatar, which is what they always were.
