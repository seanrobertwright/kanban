import type { Principal } from "@/features/auth/server/principal";
import { query, queryOne } from "@/shared/db/client";
import {
  AuthzError,
  requireBoardRole,
  requireWorkspaceRole,
} from "@/features/workspaces/server/authz";
import { createColumn } from "@/features/board/server/columns";
import { createSlaPolicy } from "@/features/sla/server/repository";
import { createAutomationRule } from "./repository";
import type {
  CreateWorkflowTemplateInput,
  WorkflowTemplate,
  WorkflowTemplateBody,
} from "../types";

/**
 * Workflow templates (051, rock 1.9). A template bundles columns + automation
 * rules + SLA policies; applying it replays the ordinary create-* repositories
 * onto a board (as the applying admin), so an applied template can do nothing a
 * human admin could not, and every created object is logged like a hand-made one.
 *
 * Built-in presets live in code (below); a workspace's own templates live in the
 * workflow_template table. Both apply through the same path.
 */

/**
 * The seed presets (Kanban / Scrum / Incident). They reference no column ids —
 * only titles, priorities, and notify/comment actions — because a template is
 * board-agnostic and cannot know a board's column ids until it is applied.
 */
export const BUILTIN_TEMPLATES: Record<
  string,
  { name: string; description: string } & WorkflowTemplateBody
> = {
  kanban: {
    name: "Kanban",
    description: "A simple flow board with WIP-friendly columns.",
    columns: ["Backlog", "To Do", "In Progress", "Done"],
    rules: [],
    slaPolicies: [],
  },
  scrum: {
    name: "Scrum",
    description: "Sprint columns with a triage nudge on new work.",
    columns: ["Backlog", "To Do", "In Progress", "Review", "Done"],
    rules: [
      {
        name: "Triage new tasks",
        trigger: { event: "task.created" },
        actions: [{ type: "comment", body: "New item — needs triage and an estimate." }],
      },
    ],
    slaPolicies: [],
  },
  incident: {
    name: "Incident",
    description:
      "Incident/service process: severity columns, an escalation SLA, and notify-on-urgent.",
    columns: ["Triage", "Investigating", "Mitigated", "Resolved"],
    rules: [
      {
        name: "Notify assignee on urgent",
        trigger: { event: "task.prioritized" },
        conditions: { field: "priority", op: "eq", value: "urgent" },
        actions: [{ type: "notify", target: "assignee", message: "Urgent incident assigned to you" }],
      },
    ],
    slaPolicies: [
      {
        name: "Urgent incident within 30m",
        appliesWhen: { field: "priority", op: "eq", value: "urgent" },
        targetMins: 30,
        actionOnBreach: [
          { type: "notify", target: "assignee", message: "SLA breached — escalate" },
          { type: "comment", body: "⚠️ Incident SLA breached." },
        ],
      },
    ],
  },
};

const TEMPLATE_COLUMNS = `id, name, description, columns, rules,
                          sla_policies AS "slaPolicies"`;

function builtinAsTemplate(key: string): WorkflowTemplate {
  const b = BUILTIN_TEMPLATES[key];
  return {
    id: `builtin:${key}`,
    name: b.name,
    description: b.description,
    columns: b.columns,
    rules: b.rules,
    slaPolicies: b.slaPolicies,
    isBuiltin: true,
  };
}

/** The workspace's saved templates plus the built-in presets. */
export async function listWorkflowTemplates(
  actor: string | Principal,
  workspaceId: string
): Promise<WorkflowTemplate[]> {
  await requireWorkspaceRole(actor, workspaceId, "viewer");
  const saved = await query<Omit<WorkflowTemplate, "isBuiltin">>(
    `SELECT ${TEMPLATE_COLUMNS} FROM workflow_template
      WHERE workspace_id = $1 ORDER BY name, id`,
    [workspaceId]
  );
  return [
    ...Object.keys(BUILTIN_TEMPLATES).map(builtinAsTemplate),
    ...saved.map((t) => ({ ...t, isBuiltin: false })),
  ];
}

export async function createWorkflowTemplate(
  userId: string,
  workspaceId: string,
  input: CreateWorkflowTemplateInput
): Promise<WorkflowTemplate> {
  await requireWorkspaceRole(userId, workspaceId, "admin");
  const rows = await query<Omit<WorkflowTemplate, "isBuiltin">>(
    `INSERT INTO workflow_template
       (workspace_id, name, description, columns, rules, sla_policies, created_by)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7)
     RETURNING ${TEMPLATE_COLUMNS}`,
    [
      workspaceId,
      input.name.trim(),
      input.description?.trim() ?? "",
      JSON.stringify(input.columns ?? []),
      JSON.stringify(input.rules ?? []),
      JSON.stringify(input.slaPolicies ?? []),
      userId,
    ]
  );
  return { ...rows[0], isBuiltin: false };
}

export async function deleteWorkflowTemplate(
  userId: string,
  id: number
): Promise<boolean> {
  const row = await queryOne<{ workspaceId: string }>(
    `SELECT workspace_id AS "workspaceId" FROM workflow_template WHERE id = $1`,
    [id]
  );
  if (!row) return false;
  await requireWorkspaceRole(userId, row.workspaceId, "admin");
  await query(`DELETE FROM workflow_template WHERE id = $1`, [id]);
  return true;
}

/** Resolves a template reference (a numeric id or "builtin:<key>") to its body. */
async function resolveTemplate(
  userId: string,
  ref: string
): Promise<WorkflowTemplateBody> {
  if (ref.startsWith("builtin:")) {
    const b = BUILTIN_TEMPLATES[ref.slice("builtin:".length)];
    if (!b) throw new AuthzError("not_found", "No such built-in template");
    return { columns: b.columns, rules: b.rules, slaPolicies: b.slaPolicies };
  }
  const id = Number(ref);
  if (!Number.isInteger(id)) throw new AuthzError("not_found", "No such template");
  const row = await queryOne<WorkflowTemplateBody & { workspaceId: string }>(
    `SELECT workspace_id AS "workspaceId", columns, rules,
            sla_policies AS "slaPolicies"
       FROM workflow_template WHERE id = $1`,
    [id]
  );
  if (!row) throw new AuthzError("not_found", "No such template");
  await requireWorkspaceRole(userId, row.workspaceId, "viewer");
  return { columns: row.columns, rules: row.rules, slaPolicies: row.slaPolicies };
}

/**
 * Applies a template to a board: appends any missing columns (by title — an
 * existing column is left alone), then creates the template's rules and SLA
 * policies. Admin on the board (it authors board-wide automation).
 */
export async function applyWorkflowTemplate(
  userId: string,
  boardId: number,
  templateRef: string
): Promise<{ columns: number; rules: number; slaPolicies: number }> {
  await requireBoardRole(userId, boardId, "admin");
  const body = await resolveTemplate(userId, templateRef);

  const existing = await query<{ title: string }>(
    `SELECT title FROM board_column WHERE board_id = $1`,
    [boardId]
  );
  const haveTitles = new Set(existing.map((c) => c.title.toLowerCase()));

  let columns = 0;
  for (const title of body.columns) {
    if (haveTitles.has(title.toLowerCase())) continue;
    await createColumn(userId, boardId, title);
    columns += 1;
  }
  for (const rule of body.rules) {
    await createAutomationRule(userId, boardId, {
      name: rule.name,
      trigger: rule.trigger,
      conditions: rule.conditions,
      actions: rule.actions,
    });
  }
  for (const sla of body.slaPolicies) {
    await createSlaPolicy(userId, boardId, {
      name: sla.name,
      appliesWhen: sla.appliesWhen,
      targetMins: sla.targetMins,
      actionOnBreach: sla.actionOnBreach,
    });
  }
  return { columns, rules: body.rules.length, slaPolicies: body.slaPolicies.length };
}
