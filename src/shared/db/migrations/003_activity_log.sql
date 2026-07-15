-- M1: the append-only, actor-typed activity log.
--
-- Serves three requirements at once (PRD §8): the audit trail that makes
-- "agents that act" sellable, the before/after substrate that undo replays, and
-- the "activity history" criterion from Core Work Items.

DO $$ BEGIN
  CREATE TYPE actor_type AS ENUM ('human', 'agent');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS activity_log (
  id           BIGSERIAL PRIMARY KEY,

  -- Tenancy is denormalized here, and ONLY here.
  --
  -- M0's rule is that a task's workspace is resolved by join, never stored, so
  -- the two cannot drift. That rule holds only while the parent outlives the
  -- child. An audit row must survive the deletion of everything it describes —
  -- there may be no task, column, or board left to join through — so the
  -- workspace has to be on the row itself. The cascade is deliberate: deleting a
  -- tenant must take their logs with them.
  workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,

  -- board_id is recorded now although M1 only renders per-task history, because
  -- it cannot be added later: backfilling it means joining through a task that
  -- may already be deleted. On an append-only table, a column you skip is a
  -- window of history you can never reconstruct.
  board_id     INTEGER,

  -- No FK on task_id, by design. REFERENCES task(id) ON DELETE CASCADE would
  -- delete the record of a task's deletion — the row that matters most — and
  -- ON DELETE SET NULL would erase which task it was. A dangling id is the point:
  -- the log outlives its subject. Safe because SERIAL never reuses ids, so this
  -- can never silently come to mean a *different* task.
  task_id      INTEGER,

  -- actor_id is polymorphic (a user id today, an agent id from M2), so it gets
  -- no FK either. That also means a user's actions survive their account being
  -- deleted, which is the entire point of an audit trail.
  actor_type   actor_type NOT NULL,
  actor_id     TEXT NOT NULL,

  -- TEXT, not an enum, unlike workspace_role. Roles are a closed set; actions
  -- grow every milestone (comments, assignees, labels, then agent tool calls),
  -- and an enum would need an ALTER TYPE in each one. The TS union in
  -- features/activity/types.ts is the source of truth.
  action       TEXT NOT NULL,

  -- Full snapshots rather than diffs: undo (M2) replays the inverse mutation,
  -- and reconstructing a task from a chain of partial diffs is strictly harder
  -- than reading one row. NULL on the side where the task did not exist.
  before       JSONB,
  after        JSONB,

  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Newest-first, which is the only order either view reads them in.
CREATE INDEX IF NOT EXISTS idx_activity_log_task
  ON activity_log(task_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_activity_log_workspace
  ON activity_log(workspace_id, id DESC);

-- Append-only, enforced by the database rather than by convention.
--
-- Scope note: this blocks UPDATE, not DELETE. UPDATE is the one that rewrites
-- history, and it has no legitimate caller — an audit row is never corrected.
-- DELETE must stay possible because workspace deletion cascades through here,
-- and a trigger that blocked it would make tenants undeletable. Real row-level
-- delete protection is a database grant, not a trigger, and belongs with the
-- retention and export work at M6.
CREATE OR REPLACE FUNCTION activity_log_no_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'activity_log is append-only; UPDATE is not permitted';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_activity_log_no_update ON activity_log;
CREATE TRIGGER trg_activity_log_no_update
  BEFORE UPDATE ON activity_log
  FOR EACH ROW EXECUTE FUNCTION activity_log_no_update();
