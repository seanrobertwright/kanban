-- Knowledge and collaboration (Phase 3): a workspace document tree.
-- A document may be workspace-wide or attached to one board.  Revisions keep
-- long-form history append-only; the current body remains cheap to read.
CREATE TYPE doc_kind AS ENUM ('page', 'meeting', 'decision');

CREATE TABLE doc (
  id SERIAL PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  board_id INTEGER REFERENCES board(id) ON DELETE SET NULL,
  parent_id INTEGER REFERENCES doc(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (btrim(title) <> ''),
  body TEXT NOT NULL DEFAULT '',
  kind doc_kind NOT NULL DEFAULT 'page',
  position INTEGER NOT NULL DEFAULT 0,
  is_published BOOLEAN NOT NULL DEFAULT false,
  created_by TEXT NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_doc_workspace_tree ON doc(workspace_id, parent_id, position, id);
CREATE INDEX idx_doc_board ON doc(board_id);
CREATE INDEX idx_doc_published_search ON doc
  USING GIN (to_tsvector('simple', title || ' ' || body)) WHERE is_published;

CREATE TABLE doc_revision (
  id SERIAL PRIMARY KEY,
  doc_id INTEGER NOT NULL REFERENCES doc(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  edited_by TEXT NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_doc_revision_doc ON doc_revision(doc_id, created_at DESC);
