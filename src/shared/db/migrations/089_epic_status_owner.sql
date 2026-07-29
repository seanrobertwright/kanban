-- Epics stop being a name (031 grew two fields, and a window it does not store).
--
-- 031 shipped an epic as `id, board_id, name` and argued the case for the
-- absence of a due date: "an epic is an open-ended bucket a milestone lives
-- *inside*, and the date that matters is the milestone's, not the epic's". That
-- argument still holds and this migration does not overturn it — no date column
-- appears below. What an epic could not say was anything about itself: which of
-- a board's fifteen buckets are live, which are ideas, which are parked, and who
-- to ask about any of them. Those are facts about the grouping, not about the
-- work inside it, so they cannot be derived and have to be stored.

-- Status: a plain field, not a lifecycle. A sprint's status (028) is enforced
-- because a sprint is a timebox — one active per board, a start that commits
-- scope, a completion that rolls unfinished work over. An epic is a bucket: it
-- has no window to open, nothing to roll over, and no reason two of them cannot
-- be active at once. So the transitions are free and the CHECK is the whole
-- rule. 'paused' earns its place beside the other three because "we stopped
-- working on this" and "we finished it" are the two things a reader most needs
-- told apart, and deriving status from progress (the alternative considered)
-- can express neither.
--
-- DEFAULT 'active', which is also what the whole existing corpus reads: every
-- epic created before today was made to file live work under, so 'active' is
-- the honest backfill rather than merely the convenient one. NOT NULL, so no
-- consumer has to decide what a null status means.
ALTER TABLE epic
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('proposed', 'active', 'paused', 'done'));

-- Owner: the person to ask about the bucket, SET NULL on their deletion — the
-- task assignee's rule (004), for the assignee's reason: losing the owner must
-- not lose the epic. A human, not the task assignee's human-or-agent pair: an
-- ownership question is answered by someone who can be asked, and an agent is
-- pointed at tasks (011's peers) rather than left holding a body of work. An
-- agent that needs to name an owner names a person.
ALTER TABLE epic
  ADD COLUMN IF NOT EXISTS owner_id TEXT
    REFERENCES "user"(id) ON DELETE SET NULL;

-- Indexed for the same reason milestone.epic_id is: the epics list filters by
-- status in the UI, but a board has tens of epics, not thousands — this index
-- is for the *owner* read ("what am I on the hook for" across a workspace),
-- which scans by owner and would otherwise walk every epic in the database.
CREATE INDEX IF NOT EXISTS idx_epic_owner
  ON epic(owner_id) WHERE owner_id IS NOT NULL;
