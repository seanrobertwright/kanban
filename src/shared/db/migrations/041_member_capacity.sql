-- Resource & capacity planning (041) — each workspace member's role and how much
-- work they can carry, so demand can be compared to capacity.
--
-- A member's capacity is a story-point budget per week (the same unit as
-- task.estimate, 022, so demand and capacity compare directly — planning in
-- hours would need a second, unrelated scale). The role is a display label
-- ("Backend", "Design") that lets the board be read by role, not just by person.
--
-- Workspace-scoped, keyed to the membership: a person's capacity is a fact about
-- them in this workspace, the level their membership lives at (001). One row per
-- member; absence means "no capacity set" (an unknown budget, not zero).
CREATE TABLE IF NOT EXISTS member_capacity (
  workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  -- Points per week this member can take on. >= 0; 0 is "none set", which the
  -- read reports as an unknown utilization rather than a divide-by-zero.
  weekly_points INTEGER NOT NULL DEFAULT 0 CHECK (weekly_points >= 0),
  -- A display label for the member's role on the work. NOT NULL DEFAULT '',
  -- two-valued like a task description — "" is "no role", never null.
  role TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (workspace_id, user_id)
);
