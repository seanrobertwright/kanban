-- Capacity learns that people go away (041 could only say how much they carry).
--
-- 041 gave a member a weekly point budget and read demand against it. The budget
-- it stored is a *nominal* one: what this person can carry in a normal week. A
-- plan built only from nominal budgets says a member on leave all week has ten
-- points of room, which is the one thing every capacity planner needs told
-- otherwise. Absence cannot be derived from anything the app already holds —
-- there is no calendar, no attendance, no leave request — so it has to be stored.
--
-- Modelled as dated ranges rather than a per-week deduction ("3 days off in the
-- week of the 6th"): a range is what a person actually knows and enters ("out
-- the 14th to the 21st"), it survives being read from any window, and it makes
-- the future readable — a per-week number would have to be re-entered for every
-- week the leave spans and could say nothing about next month.
--
-- No hours, no half days, no leave *types* (holiday vs sick vs parental). The
-- capacity read prorates a weekly point budget by whole available workdays, so a
-- half day cannot change its answer, and a leave type is an HR fact this app has
-- no policy for — the note field carries whatever a human needs to see.
CREATE TABLE IF NOT EXISTS member_time_off (
  id BIGSERIAL PRIMARY KEY,
  -- Workspace-scoped and keyed to the person, like member_capacity (041): being
  -- away is a fact about a member of this workspace, not about one board.
  workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  -- Inclusive on both ends: a one-day absence is starts_on = ends_on, which is
  -- what a person entering "I'm out Friday" means. A half-open range would make
  -- that case a two-date entry nobody types correctly.
  starts_on DATE NOT NULL,
  ends_on DATE NOT NULL,
  -- Two-valued like role (041) and task description: '' is "no note", never null.
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- A backwards range is a data-entry slip, not a plan. Refused in SQL as well
  -- as in the handler, because the capacity read's day-counting walks from start
  -- to end and an inverted row would silently count as zero days off.
  CHECK (ends_on >= starts_on)
);

-- Overlapping entries are allowed on purpose (two systems syncing the same
-- leave, or a sick day inside a holiday). The read counts *distinct* workdays,
-- so a duplicate cannot deduct twice — enforcing non-overlap in SQL would
-- instead make the second, honest entry fail.

-- The read is always "this member's entries touching this window", so the index
-- carries the member key and the range start.
CREATE INDEX IF NOT EXISTS idx_member_time_off_member
  ON member_time_off(workspace_id, user_id, starts_on);
