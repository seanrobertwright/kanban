-- Timesheet approval (027 follow-up).
--
-- 027 shipped time_entry as an append-only ledger and stopped there: anyone
-- could log minutes and nobody could sign them off. That is fine while the
-- ledger is a personal note and wrong the moment it is the basis of a client
-- invoice or a capacity report — which is exactly what the board timesheet made
-- it. Without a review step, "40 hours on this board last week" is a claim, not
-- a number anyone can stand behind.
--
-- Approval is per (contributor, board, week), not per entry. The unit a
-- reviewer actually works in is a person's week — approving 60 individual
-- entries one at a time is ceremony, and approving a whole board at once would
-- erase who signed off on whom. The week is identified by its Monday, stored as
-- a DATE, so the key is a fact rather than an ISO-week string whose meaning
-- depends on a locale.
CREATE TABLE IF NOT EXISTS timesheet_approval (
  id SERIAL PRIMARY KEY,
  board_id INTEGER NOT NULL REFERENCES board(id) ON DELETE CASCADE,
  -- Whose week this is. TEXT with no FK, time_entry's rule (005): the ledger
  -- and its sign-off both outlive the account.
  user_id TEXT NOT NULL,
  -- The Monday of the week being signed off.
  week_start DATE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('submitted', 'approved', 'rejected')),
  -- Who reviewed it. NULL while merely submitted — a contributor submitting
  -- their own week is not a review.
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  -- Why it was rejected. Required in practice by the handler, not by the
  -- database: a rejection with no reason is a dead end for the contributor,
  -- but an approval needs no note and the column must stay optional for it.
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- One verdict per person per week per board. A re-review overwrites it, so
  -- the current state is always a single row and "approved then rejected" is a
  -- correction rather than two contradictory facts on file.
  UNIQUE (board_id, user_id, week_start)
);

CREATE INDEX IF NOT EXISTS idx_timesheet_approval_board
  ON timesheet_approval(board_id, week_start);
