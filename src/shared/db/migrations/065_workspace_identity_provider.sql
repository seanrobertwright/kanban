CREATE TABLE workspace_identity_provider (
  workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL UNIQUE,
  protocol TEXT NOT NULL CHECK (protocol IN ('oidc', 'saml')),
  created_by TEXT NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, provider_id)
);
