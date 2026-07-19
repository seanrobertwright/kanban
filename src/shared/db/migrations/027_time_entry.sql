-- Time tracking: minutes spent, logged against a task.
--
-- An append-only ledger of work done, not a timer: an entry says "N minutes,
-- by this person, on this date, optionally why". Timers are UI ceremony over
-- exactly this table, and can arrive later without touching it.
CREATE TABLE IF NOT EXISTS time_entry (
  id SERIAL PRIMARY KEY,
  -- CASCADE: unlike a checklist, a time entry is meaningless without its task
  -- — but deleteTask snapshots the task first, so the deletion is still on
  -- record even though the minutes go with it.
  task_id INTEGER NOT NULL REFERENCES task(id) ON DELETE CASCADE,
  -- Who spent the time. TEXT, no foreign key — author_id's rule (005): the
  -- ledger outlives the account. Humans only today; an agent's "time" is
  -- metered in dollars by the run's cost telemetry, not in minutes here.
  user_id TEXT NOT NULL,
  minutes INTEGER NOT NULL CHECK (minutes > 0),
  -- The day the work happened — DATE, 006's argument: "worked Tuesday" is a
  -- calendar fact, not an instant. Defaults to the day the entry was made.
  spent_on DATE NOT NULL DEFAULT CURRENT_DATE,
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_time_entry_task ON time_entry(task_id);
