-- M1: labels — the vocabulary an agent triages with.
--
-- The third of §9's "fields an agent reasons over when triaging", split from 006
-- because it is not a field. Priority and a due date are columns; a label is a
-- table, a join, and a vocabulary someone has to maintain.
--
-- The shape is what makes this useful to an agent rather than to a filing
-- cabinet. M2's criterion #1 has an agent label twenty inbound bugs, and the
-- question that decides the schema is what it is allowed to write. Free text —
-- Jira's answer, and a TEXT[] on task would have been half the code — lets it
-- invent `bug`, `Bug`, `bugs` and `defect` across twenty tasks, each a category
-- of one. A controlled set makes labelling a *choice from a vocabulary*, which
-- is a thing a model does well and a thing a human can audit. The same property
-- is what makes M5's "when a bug is labeled P0" a rule that can be written down.

-- A closed set, so an enum — 001's rule, and 006's. Note the emphasis is the
-- opposite of task_priority's, though: there the declaration order *is* the sort
-- order and half the reason to use an enum. Nothing orders by colour, and the
-- order below is arbitrary. This is an enum purely to close the set.
--
-- A palette rather than free hex, for the reason the vocabulary is closed at all:
-- a board where everyone picks their own #hex stops being scannable, and it lets
-- someone choose white on white. Growing this is a design decision, which is
-- exactly what an enum makes someone make on purpose.
DO $$ BEGIN
  CREATE TYPE label_color AS ENUM
    ('slate', 'red', 'amber', 'green', 'sky', 'violet', 'pink');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS label (
  id           SERIAL PRIMARY KEY,

  -- Scoped to the workspace, not the board — the one real choice here, and the
  -- opposite of board_column's. A workflow belongs to a board: "In Review" means
  -- what this board's team does, and another board may not have the step at all.
  -- A vocabulary does not: "bug" means the same thing wherever it is written, and
  -- scoping it per board would have each board redefine it, then leave M3's
  -- cross-board filters and M4's backlog joining on a string. It also matches
  -- where the reader is — an agent is given a workspace, not a board.
  --
  -- CASCADE: a label is meaningless outside the workspace that defines it, and a
  -- workspace must stay deletable (003's reasoning for why activity_log permits
  -- DELETE at all).
  workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,

  name         TEXT NOT NULL,
  color        label_color NOT NULL DEFAULT 'slate',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- This index IS the controlled vocabulary. Everything above is a table of
-- strings until something forbids the second one that differs only in case —
-- `bug` and `Bug` as two labels is precisely the drift the whole design is for,
-- and it is not a lint, it is a constraint.
--
-- A functional unique index rather than a UNIQUE constraint on the table:
-- Postgres constraints take columns, not expressions, so lower(name) can only be
-- said here. The repository still checks first, to answer 409 with a sentence
-- rather than let a 23505 surface as a 500 — but the index is what makes it true
-- under concurrency, where two requests both check, both find nothing, and both
-- insert.
CREATE UNIQUE INDEX IF NOT EXISTS idx_label_workspace_name
  ON label (workspace_id, lower(name));

CREATE TABLE IF NOT EXISTS task_label (
  -- CASCADE on both sides, and for once there is no tension in it. A link is not
  -- a thing that can outlive either end: a label on a deleted task is about
  -- nothing, and a deleted label's links are references to a vocabulary entry
  -- that no longer exists. Compare activity_log, which carries no FK at all
  -- precisely because the record of a labelling must survive both.
  --
  -- The rows this destroys are links, not work — which is what makes deleting a
  -- populated label allowed where deleting a populated column is refused with a
  -- 409. That guard exists because task.column_id CASCADEs and would take the
  -- tasks with it. Here the tasks are untouched; they simply lose a label,
  -- which is what "delete this label" means. Refusing until every task is
  -- unlabelled by hand would be ceremony, the same call 006's predecessor made
  -- for the last column.
  --
  -- The repository logs one task.labeled row per affected task before deleting,
  -- for unassignFromWorkspace's reason: a reader of a task's history is the only
  -- audience for why a label vanished from their card, and "deleted a label"
  -- somewhere in a workspace feed is not attributable or revertible per task.
  task_id  INTEGER NOT NULL REFERENCES task(id) ON DELETE CASCADE,
  label_id INTEGER NOT NULL REFERENCES label(id) ON DELETE CASCADE,

  -- The pair is the row; there is nothing else to say about it, and no surrogate
  -- id would ever be referenced. The PK doubles as the index for "this task's
  -- labels", which is the read every board does.
  PRIMARY KEY (task_id, label_id)
);

-- The other direction: "every task with this label". Not read by the board,
-- which goes task-first through the PK above — this serves deleting a label
-- (which must find the tasks it is about to unlabel, to log them) and M3's
-- cross-board filter. The PK's leading column cannot answer it.
CREATE INDEX IF NOT EXISTS idx_task_label_label
  ON task_label (label_id);

-- Not enforceable in the schema, and stated here for the reason 004 states its
-- twin:
--
--   INVARIANT: a task's labels belong to the task's workspace.
--
-- The FK proves the label exists *somewhere*. Proving it belongs here means
-- joining task -> board_column -> board against label.workspace_id, which no
-- CHECK can see — the same shape as 004's assignee invariant, and refused for
-- the same reason: the alternative is denormalizing workspace_id onto task, and
-- M0 rejected that by name. So it lives in the repository next to the RBAC
-- checks. See assertLabelsInWorkspace() in features/labels/server/repository.ts.
--
-- Without it, any label id in the database could be written onto any task, and a
-- stranger's vocabulary would render on a board that never defined it.
