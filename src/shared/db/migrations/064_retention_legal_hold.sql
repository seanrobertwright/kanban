CREATE TABLE retention_policy (
  id SERIAL PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  subject_type TEXT NOT NULL CHECK (subject_type IN ('activity_log', 'task', 'comment', 'attachment', 'doc')),
  max_age_days INTEGER NOT NULL CHECK (max_age_days BETWEEN 1 AND 36500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, subject_type)
);
CREATE TABLE legal_hold (
  id BIGSERIAL PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  subject_type TEXT NOT NULL CHECK (subject_type IN ('task', 'comment', 'attachment', 'doc')),
  subject_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  released_at TIMESTAMPTZ,
  released_by TEXT REFERENCES "user"(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, subject_type, subject_id)
);
CREATE INDEX idx_legal_hold_active ON legal_hold(workspace_id, subject_type, subject_id) WHERE released_at IS NULL;
