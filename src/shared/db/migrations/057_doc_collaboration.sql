-- Durable CRDT state for Phase 3 real-time docs.  Updates append cheaply while
-- a room is busy; the websocket service compacts them into a snapshot when the
-- last collaborator leaves.
CREATE TABLE doc_yjs_snapshot (
  doc_id INTEGER PRIMARY KEY REFERENCES doc(id) ON DELETE CASCADE,
  state BYTEA NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE doc_yjs_update (
  id BIGSERIAL PRIMARY KEY,
  doc_id INTEGER NOT NULL REFERENCES doc(id) ON DELETE CASCADE,
  update BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_doc_yjs_update_doc ON doc_yjs_update(doc_id, id);
