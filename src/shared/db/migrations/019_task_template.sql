-- M3 (Core Work Items): task templates — save a task shape, instantiate it.
--
-- The one real decision is what a template's shape *is*, and it is the reusable
-- half of a task and nothing else: title, description, priority, labels. The
-- per-instance half is deliberately absent —
--
--   assignee   — who does THIS one varies, and storing it would drag the Actor /
--                agent / native-run machinery (011) into a config row. A template
--                is what the work is, not whose it is.
--   due_date   — an absolute date cannot be reused; "next Friday" is not a value
--                this table could hold, and a fixed date is wrong the day after.
--   column /   — placement is the act of instantiating, not part of the shape.
--   parent       The template says what to make; the New-task flow says where.
--
-- Workspace-scoped, like the label vocabulary it references (007) and unlike a
-- board's workflow: a team's standard task shapes are shared across their boards.
-- The labels a template carries are that same workspace vocabulary, which is why
-- template_label mirrors task_label exactly, cascade and all.
--
-- Instantiation is NOT a row or an operation in this schema, and that is the
-- second half of the decision. The New-task dialog prefills its form from a
-- template and the ordinary createTask does the write — so there is one authz
-- path, one task.created log row, and no second write path to keep in step. A
-- template never touches the task write path; it only fills in the form someone
-- (or an agent, which has createTask) submits.
--
-- No activity_log rows, and the contrast with labels is the reason rather than
-- 017's. A label deletion mutates every task wearing it, so §7.4's blast-radius
-- rule makes it admin-only and logs one row per affected task. A template
-- deletion touches nothing but the template — it has no task-side effect to
-- attribute or revert — so, like a saved view (015), it neither logs nor needs
-- admin: member is the rank to create, edit, and delete one.

CREATE TABLE IF NOT EXISTS task_template (
  id           SERIAL PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  -- The same enum a task's priority uses (006), so a template states a value the
  -- task write path already understands and instantiation copies it across with
  -- no translation. NOT NULL DEFAULT 'none' for task.priority's reason: "not
  -- triaged" is a value worth naming, and it keeps the field two-valued.
  priority     task_priority NOT NULL DEFAULT 'none',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The one read is "this workspace's templates". No unique index on the title,
-- unlike label's controlled vocabulary (007): two templates called "Bug report"
-- are a convenience, not the rot a duplicate label is — a template is picked from
-- a short list and instantiated, never matched by name.
CREATE INDEX IF NOT EXISTS idx_task_template_workspace
  ON task_template(workspace_id);

-- A template's labels — task_label one relation over, and the same shape for the
-- same reasons. The FK to label CASCADEs, so deleting a label removes it from
-- every template that carried it, exactly as it does from every task: a template
-- can never name a label its workspace no longer has, which is what keeps
-- instantiation from ever failing on a dangling label id.
CREATE TABLE IF NOT EXISTS template_label (
  template_id INTEGER NOT NULL REFERENCES task_template(id) ON DELETE CASCADE,
  label_id    INTEGER NOT NULL REFERENCES label(id) ON DELETE CASCADE,
  PRIMARY KEY (template_id, label_id)
);
