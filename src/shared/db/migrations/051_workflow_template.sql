-- Workflow templates (051, rock 1.9) — a reusable process bundle: a column set, a
-- set of automation rules, and a set of SLA policies, applied to a board in one
-- move. The task-templates pattern (019), one level up: 019 templates a task,
-- this templates a whole way of working.
--
-- Workspace-scoped (a process is a workspace asset, reused across its boards). The
-- three bundles are JSONB — the shapes the automation/SLA repositories already
-- validate on apply — not normalized tables, because a template is authored and
-- read as one whole and only instantiated (never queried piecemeal). Built-in
-- presets (Kanban/Scrum/Incident) live in code, not here; this table holds the
-- workspace's own saved templates.
CREATE TABLE IF NOT EXISTS workflow_template (
  id SERIAL PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (btrim(name) <> ''),
  description TEXT NOT NULL DEFAULT '',
  columns JSONB NOT NULL DEFAULT '[]',       -- ["To Do", "In Progress", ...]
  rules JSONB NOT NULL DEFAULT '[]',          -- [{name, trigger, conditions, actions}]
  sla_policies JSONB NOT NULL DEFAULT '[]',   -- [{name, appliesWhen, targetMins, actionOnBreach}]
  created_by TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workflow_template_ws
  ON workflow_template(workspace_id);
