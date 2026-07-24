CREATE TABLE integration_oauth_state (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('slack', 'teams', 'google', 'microsoft')),
  workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_integration_oauth_state_expiry ON integration_oauth_state(expires_at);
