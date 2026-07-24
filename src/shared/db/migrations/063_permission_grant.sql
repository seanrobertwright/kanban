CREATE TABLE permission_grant (
  id BIGSERIAL PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  subject_type TEXT NOT NULL CHECK (subject_type IN ('board', 'custom_field', 'action')),
  subject_id TEXT NOT NULL,
  principal_type TEXT NOT NULL CHECK (principal_type IN ('user', 'workspace_role')),
  principal_id TEXT NOT NULL,
  capability TEXT NOT NULL CHECK (capability IN ('read', 'write', 'manage', 'view', 'edit', 'execute')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, subject_type, subject_id, principal_type, principal_id, capability)
);
CREATE INDEX idx_permission_grant_lookup
  ON permission_grant(workspace_id, subject_type, subject_id, capability);
