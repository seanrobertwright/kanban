-- Provider-owned references stay separate from object-storage attachments: the
-- app never proxies third-party file bytes or accidentally grants public URLs.
CREATE TABLE integration_link (
  id SERIAL PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES task(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('google', 'microsoft')),
  external_id TEXT NOT NULL,
  url TEXT NOT NULL,
  name TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_by TEXT NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(task_id, provider, external_id)
);
CREATE INDEX idx_integration_link_task ON integration_link(task_id, provider);
