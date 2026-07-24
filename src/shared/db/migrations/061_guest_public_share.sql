ALTER TYPE workspace_role ADD VALUE IF NOT EXISTS 'guest';
CREATE TABLE object_share (
  subject_type TEXT NOT NULL CHECK (subject_type IN ('board','doc','form')),
  subject_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  can_edit BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(subject_type,subject_id,user_id)
);
CREATE TABLE public_link (
  id SERIAL PRIMARY KEY,
  subject_type TEXT NOT NULL CHECK (subject_type IN ('board','doc','form','view')),
  subject_id TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  scope TEXT NOT NULL CHECK (scope IN ('read','submit')),
  expires_at TIMESTAMPTZ,
  created_by TEXT NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_public_link_token ON public_link(token);
