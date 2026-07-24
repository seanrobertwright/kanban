CREATE TABLE workspace_extension (
  id SERIAL PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  manifest JSONB NOT NULL,
  url TEXT NOT NULL,
  capabilities TEXT[] NOT NULL DEFAULT '{}',
  slots TEXT[] NOT NULL DEFAULT '{}',
  installed_by TEXT NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, name)
);
CREATE INDEX idx_workspace_extension_workspace ON workspace_extension(workspace_id);
