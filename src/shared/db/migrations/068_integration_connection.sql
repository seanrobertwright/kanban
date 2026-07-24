-- Phase 7 shared credential store. Provider tokens are encrypted by the
-- application before insertion; this table never receives plaintext OAuth data.
CREATE TABLE integration_connection (
  id SERIAL PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('slack', 'teams', 'email', 'google', 'microsoft')),
  external_id TEXT NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  scopes TEXT[] NOT NULL DEFAULT '{}',
  metadata JSONB NOT NULL DEFAULT '{}',
  created_by TEXT NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, provider, external_id)
);
CREATE INDEX idx_integration_connection_workspace ON integration_connection(workspace_id, provider);
