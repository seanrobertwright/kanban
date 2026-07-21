-- User-defined fields: metadata a board defines for itself.
--
-- Board-scoped like milestones (026), not workspace-scoped like labels: a custom
-- field ("Account", "Component", "Impact") is a fact about how one board models
-- its work, and a second board's "Impact" is a different question. A definition
-- lives here; a task's answer lives in custom_field_value.
--
-- Scope note (035): custom fields are deliberately NOT wired into activity_log or
-- undo. TaskSnapshot is a fixed shape, and snapshotting a dynamic, per-board set
-- of fields — and teaching undo to restore a deleted field's values — is a larger
-- design than this first cut. Definitions and values are managed directly.
CREATE TABLE IF NOT EXISTS custom_field (
  id SERIAL PRIMARY KEY,
  board_id INTEGER NOT NULL REFERENCES board(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (btrim(name) <> ''),
  -- The field's kind, which decides how its value is edited and validated. A
  -- CHECK rather than an enum type: the set is small and app-owned, and a plain
  -- text CHECK is one migration to widen (029's lesson) where an enum needs ALTER
  -- TYPE. 'select' is the only kind that reads `options`.
  type TEXT NOT NULL CHECK (type IN ('text', 'number', 'date', 'select', 'checkbox')),
  -- The choices for a 'select' field, in display order; empty for every other
  -- kind. TEXT[] rather than a child table: options are a small ordered list read
  -- and written whole with the field, never queried across fields.
  options TEXT[] NOT NULL DEFAULT '{}',
  -- Display order among a board's fields, a column's position (007) one table over.
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_custom_field_board ON custom_field(board_id);

-- One task's answer for one field. Value is TEXT for every kind — a number, a
-- date, a checkbox's 'true'/'false', a select's chosen option — interpreted by
-- the field's type, the way time_entry and comment keep their content plain.
CREATE TABLE IF NOT EXISTS custom_field_value (
  -- Both CASCADE: a value is meaningless without its task and without its field,
  -- so deleting either takes the value. Deleting a field thus clears its column
  -- across every task, which is the "definitions and values managed directly"
  -- cut above — no log row mourns it.
  task_id INTEGER NOT NULL REFERENCES task(id) ON DELETE CASCADE,
  field_id INTEGER NOT NULL REFERENCES custom_field(id) ON DELETE CASCADE,
  value TEXT NOT NULL,
  PRIMARY KEY (task_id, field_id)
);

CREATE INDEX IF NOT EXISTS idx_custom_field_value_field
  ON custom_field_value(field_id);
