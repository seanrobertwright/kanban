CREATE TABLE ip_allowlist (
  id SERIAL PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  cidr TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, cidr)
);
CREATE INDEX idx_ip_allowlist_workspace ON ip_allowlist(workspace_id);
