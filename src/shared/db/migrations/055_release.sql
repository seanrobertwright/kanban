-- Release management (055, rock 2.8) — versions/releases grouping delivered work.
--
-- A release is the milestone's git-native cousin: a named version ("v1.2.0") that
-- gathers the tasks it ships and has a lifecycle a *git tag* drives. Where a
-- milestone is a checkpoint a human closes, a release flips from planned →
-- released when the provider publishes the matching tag (2.0's ingress fires it),
-- so "the board says v1.2.0 shipped" is a fact the git host asserts, not a button
-- someone remembers to press.
--
-- task.release_id is the milestone_id twin (SET NULL): un-tagging a task from a
-- release leaves the task and its history intact.
CREATE TABLE IF NOT EXISTS release (
  id SERIAL PRIMARY KEY,
  board_id INTEGER NOT NULL REFERENCES board(id) ON DELETE CASCADE,
  -- The version string a git tag matches on ("v1.2.0"). Board-scoped like a
  -- milestone: a second board's v1.2.0 is a different release.
  name TEXT NOT NULL CHECK (btrim(name) <> ''),
  state TEXT NOT NULL DEFAULT 'planned' CHECK (state IN ('planned', 'released')),
  -- Stamped when the release flips to 'released' (a human close or a git tag).
  released_at TIMESTAMPTZ,
  -- Release notes: author-supplied, the provider's tag body, or auto-generated
  -- from the shipped tasks' titles at release time (derive-don't-store's exception
  -- — notes are a point-in-time artifact, so they are frozen when cut, not re-derived).
  notes TEXT,
  -- The provider's release/tag URL, stamped by the ingress when a tag publishes it.
  url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (board_id, name)
);

CREATE INDEX IF NOT EXISTS idx_release_board ON release(board_id);

-- The task→release aim, milestone_id's twin. SET NULL so deleting a release
-- un-ships its tasks rather than destroying them.
ALTER TABLE task ADD COLUMN IF NOT EXISTS release_id INTEGER
  REFERENCES release(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_task_release ON task(release_id);
