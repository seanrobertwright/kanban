-- Product discovery + Feedback intake (043) — one model, two capability rows.
--
-- The board is where committed work lives (tasks in columns). Discovery is the
-- stage *before* that commitment: ideas that are still being explored, the
-- customer/stakeholder feedback that argues for them, and the moment a validated
-- idea is promoted into a real task. Two tables, board-scoped for the milestone
-- reason (026): an "idea" and a "feedback" are facts about one board's product,
-- and a second board's discovery is its own.

-- An idea is a candidate for future work, not yet a task. It moves through a
-- discovery pipeline (exploring → validating → validated → promoted | archived)
-- and carries the four RICE inputs so the backlog can be ranked by expected
-- value. The RICE score itself is derived in code (lib/discovery.ts), never
-- stored — priority_score's / budget's derive-don't-store rule, so re-weighting
-- the formula never means a migration.
CREATE TABLE IF NOT EXISTS idea (
  id SERIAL PRIMARY KEY,
  board_id INTEGER NOT NULL REFERENCES board(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (btrim(title) <> ''),
  -- Two-valued like a task's description — "" is "no detail", never null.
  description TEXT NOT NULL DEFAULT '',
  -- The discovery pipeline stage. 'promoted' is set by the promote path (which
  -- also stamps promoted_task_id); 'archived' retires an idea without deleting
  -- its feedback history.
  status TEXT NOT NULL DEFAULT 'exploring'
    CHECK (status IN ('exploring', 'validating', 'validated', 'promoted', 'archived')),
  -- RICE inputs. reach = people/accounts affected per period; impact on a 1..5
  -- massive..minimal scale; confidence as a percent; effort in person-weeks
  -- (>= 1 so the score never divides by zero). A fresh idea reads reach 0 →
  -- RICE 0, the honest-zero the board uses everywhere.
  reach INTEGER NOT NULL DEFAULT 0 CHECK (reach >= 0),
  impact INTEGER NOT NULL DEFAULT 1 CHECK (impact BETWEEN 1 AND 5),
  confidence INTEGER NOT NULL DEFAULT 100 CHECK (confidence BETWEEN 0 AND 100),
  effort INTEGER NOT NULL DEFAULT 1 CHECK (effort >= 1),
  -- The task an idea became, once promoted. SET NULL (milestone_id's shape):
  -- deleting the task un-links the idea rather than deleting the idea with it,
  -- so the discovery record survives the delivery record.
  promoted_task_id INTEGER REFERENCES task(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_idea_board ON idea(board_id);

-- A piece of customer or stakeholder feedback — the intake channel. It stands on
-- its own (a raw signal) and can be attached to the idea it argues for, so an
-- idea accumulates demand (how many pieces of feedback, how many votes) that the
-- promote note carries into the task. Attaching is optional and reversible.
CREATE TABLE IF NOT EXISTS feedback (
  id SERIAL PRIMARY KEY,
  board_id INTEGER NOT NULL REFERENCES board(id) ON DELETE CASCADE,
  -- The idea this feedback is filed under, or null for the unsorted inbox.
  -- SET NULL: deleting an idea returns its feedback to the inbox, it does not
  -- destroy the raw signal.
  idea_id INTEGER REFERENCES idea(id) ON DELETE SET NULL,
  body TEXT NOT NULL CHECK (btrim(body) <> ''),
  -- Who it came from (a customer name, a segment, "sales") — free text because
  -- the source is often outside the workspace's user table. "" is "unattributed".
  source TEXT NOT NULL DEFAULT '',
  sentiment TEXT NOT NULL DEFAULT 'idea'
    CHECK (sentiment IN ('praise', 'problem', 'idea', 'question')),
  -- Demand signal. Starts at 1 (the act of capturing it is one voice); an
  -- upvote bumps it. Never negative.
  votes INTEGER NOT NULL DEFAULT 1 CHECK (votes >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_feedback_board ON feedback(board_id);
CREATE INDEX IF NOT EXISTS idx_feedback_idea ON feedback(idea_id) WHERE idea_id IS NOT NULL;
