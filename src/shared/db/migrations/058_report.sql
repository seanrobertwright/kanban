-- Custom & financial reports (058, rocks 5.1 + 5.2) — a saved, user-defined
-- report over the existing read model. A row is a *definition*, never a result:
-- it names a data source, a reused saved-view filter (015), a grouping, a
-- metric, and a viz. Results are DERIVED at read time by the pure
-- runReport(report, rows) fold over facts the repository gathers — the
-- derive-don't-store rule. Financial reports (5.2) are just source='financial',
-- rolling logged minutes × board.hourly_rate (042) into spend; no new money is
-- stored, it is computed the same way the budget rollup is.
--
-- Scope is board_id (one board) or NULL (the whole workspace, via the portfolio
-- query 040). Visibility mirrors saved views: 'private' is the owner's alone
-- (authored at member level); 'shared' is workspace-wide (authored at admin
-- level) — the §7.4 blast-radius rule.
CREATE TABLE IF NOT EXISTS report (
  id           SERIAL PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  -- NULL = cross-board (portfolio); set = a single board within the workspace.
  board_id     INTEGER REFERENCES board(id) ON DELETE CASCADE,
  created_by   TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  name         TEXT NOT NULL CHECK (btrim(name) <> ''),
  -- What the report reads: task rows, the time ledger, the flow (cycle) replay,
  -- or the financial roll-up (minutes × rate).
  source       TEXT NOT NULL CHECK (source IN ('tasks', 'time', 'flow', 'financial')),
  -- Reused saved-view (015) predicate; {} = no filter (all rows in scope).
  filter       JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- The bucket key for the x-axis / rows. 'none' = a single total bar.
  group_by     TEXT NOT NULL DEFAULT 'none'
                 CHECK (group_by IN ('none','status','assignee','priority','label','board','user','day')),
  -- The aggregate applied within each bucket.
  metric       TEXT NOT NULL
                 CHECK (metric IN ('count','sum:estimate','sum:minutes','avg:cycle','sum:spend')),
  viz          TEXT NOT NULL DEFAULT 'table' CHECK (viz IN ('bar','line','table')),
  visibility   TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','shared')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The workspace listing (shared reports + the caller's own private ones).
CREATE INDEX IF NOT EXISTS idx_report_workspace ON report(workspace_id);
-- The owner's private-report lookup.
CREATE INDEX IF NOT EXISTS idx_report_owner ON report(workspace_id, created_by);
-- No two reports share a name within a workspace (case-insensitive), so the
-- client can address one by name and the builder can upsert-by-name.
CREATE UNIQUE INDEX IF NOT EXISTS report_name_unique
  ON report (workspace_id, lower(name));
