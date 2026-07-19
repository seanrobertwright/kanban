import type { PoolClient } from "pg";

import { query, withTransaction } from "@/shared/db/client";
import { assertLabelsInWorkspace } from "@/features/labels/server/repository";
import type { Principal } from "@/features/auth/server/principal";
import {
  AuthzError,
  requireWorkspaceRole,
} from "@/features/workspaces/server/authz";
import type {
  CreateTemplateInput,
  TaskTemplate,
  UpdateTemplateInput,
} from "../types";

/**
 * A template's columns, labels resolved to a json array of {id, name} inline —
 * labelsSubquery (task-row) one relation over, and load-bearing for the same
 * reason: query<TaskTemplate> is a cast, not a check, so a read that forgot the
 * labels would type as a whole template and render a picker that silently drops
 * them. COALESCE to '[]' because json_agg over no rows is NULL, and a template's
 * labels are never null — the empty set is [], which is what keeps labelIds
 * two-valued on the way back out. `task_template.id` qualified for its scope, as
 * labelsSubquery's `taskRef` is: the inner scope has its own id.
 */
const TEMPLATE_COLUMNS = `id, workspace_id AS "workspaceId", title, description,
  priority,
  COALESCE((SELECT json_agg(json_build_object('id', l.id, 'name', l.name)
                            ORDER BY l.id)
              FROM template_label tl
              JOIN label l ON l.id = tl.label_id
             WHERE tl.template_id = task_template.id), '[]'::json) AS labels,
  created_at AS "createdAt"`;

function selectTemplate(
  client: PoolClient,
  id: number
): Promise<TaskTemplate | undefined> {
  return client
    .query<TaskTemplate>(
      `SELECT ${TEMPLATE_COLUMNS} FROM task_template WHERE id = $1`,
      [id]
    )
    .then((r) => r.rows[0]);
}

/**
 * Resolves a template id to its workspace, or 404 — and 404 (not 403) when it is
 * another workspace's, following M0's rule: "no such template" and "not yours"
 * are one answer, or the id space becomes an oracle. requireLabelRole's twin.
 */
async function requireTemplateRole(
  userId: string,
  templateId: number,
  role: "viewer" | "member" | "admin"
): Promise<{ workspaceId: string }> {
  const rows = await query<{ workspaceId: string }>(
    `SELECT workspace_id AS "workspaceId" FROM task_template WHERE id = $1`,
    [templateId]
  );
  const row = rows[0];
  if (!row) throw new AuthzError("not_found", "Template not found");
  await requireWorkspaceRole(userId, row.workspaceId, role);
  return { workspaceId: row.workspaceId };
}

/**
 * Replaces a template's label set — setTaskLabels one relation over, and the
 * same delete-what-is-gone / insert-what-is-new shape so a save does not churn
 * every row. `<> ALL('{}')` is true for every row, so an empty set clears it.
 */
async function setTemplateLabels(
  client: PoolClient,
  templateId: number,
  labelIds: number[]
): Promise<void> {
  const wanted = [...new Set(labelIds)];
  await client.query(
    `DELETE FROM template_label
      WHERE template_id = $1 AND label_id <> ALL($2::int[])`,
    [templateId, wanted]
  );
  if (wanted.length > 0) {
    await client.query(
      `INSERT INTO template_label (template_id, label_id)
       SELECT $1, unnest($2::int[])
       ON CONFLICT DO NOTHING`,
      [templateId, wanted]
    );
  }
}

/**
 * The workspace's templates, by title. Viewer is enough, and agent-capable
 * (Principal): a template is a shape to instantiate, not PII, and an agent that
 * builds a task from one reads it here then calls createTask itself — which is
 * why there is no separate instantiate write path to authorize. lower(title) so
 * the order does not depend on case, listLabels' reasoning.
 */
export async function listTemplates(
  actor: string | Principal,
  workspaceId: string
): Promise<TaskTemplate[]> {
  await requireWorkspaceRole(actor, workspaceId, "viewer");
  return query<TaskTemplate>(
    `SELECT ${TEMPLATE_COLUMNS} FROM task_template
      WHERE workspace_id = $1
      ORDER BY lower(title), id`,
    [workspaceId]
  );
}

/**
 * Creates a template. "member", the rank createLabel asks: minting shared config
 * is an ordinary act. assertLabelsInWorkspace before the write, so a template can
 * never carry a label from another workspace — 007's invariant, reused whole.
 */
export async function createTemplate(
  userId: string,
  workspaceId: string,
  input: CreateTemplateInput
): Promise<TaskTemplate> {
  await requireWorkspaceRole(userId, workspaceId, "member");

  return withTransaction(async (client) => {
    if (input.labelIds?.length) {
      await assertLabelsInWorkspace(client, workspaceId, input.labelIds);
    }
    const { rows } = await client.query<{ id: number }>(
      `INSERT INTO task_template (workspace_id, title, description, priority)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [workspaceId, input.title, input.description ?? "", input.priority ?? "none"]
    );
    // Linked before the read-back, because TEMPLATE_COLUMNS resolves labels with
    // a subquery — RETURNING on the INSERT would report a template with no labels
    // whatever was asked for. createTask's own reason, one feature over.
    await setTemplateLabels(client, rows[0].id, input.labelIds ?? []);
    return (await selectTemplate(client, rows[0].id))!;
  });
}

export async function updateTemplate(
  userId: string,
  templateId: number,
  input: UpdateTemplateInput
): Promise<TaskTemplate> {
  const { workspaceId } = await requireTemplateRole(userId, templateId, "member");

  return withTransaction(async (client) => {
    if (input.labelIds?.length) {
      await assertLabelsInWorkspace(client, workspaceId, input.labelIds);
    }
    // Before the UPDATE, so the read-back sees them. No supplied-flag: [] is "no
    // labels" and undefined is "leave them" — 006's rule, the labelIds column of
    // updateTask holding here too.
    if (input.labelIds !== undefined) {
      await setTemplateLabels(client, templateId, input.labelIds);
    }
    const { rows } = await client.query<TaskTemplate>(
      `UPDATE task_template
          SET title = COALESCE($2, title),
              description = COALESCE($3, description),
              priority = COALESCE($4::task_priority, priority)
        WHERE id = $1
        RETURNING ${TEMPLATE_COLUMNS}`,
      [
        templateId,
        input.title ?? null,
        input.description ?? null,
        input.priority ?? null,
      ]
    );
    return rows[0];
  });
}

/**
 * Deletes a template. "member", not "admin", and the contrast with deleteLabel is
 * deliberate (see 019): a label deletion reaches every task wearing it, a
 * template deletion reaches nothing but itself — template_label CASCADEs and no
 * task is touched — so there is no blast radius to gate behind the higher rank.
 * Returns false when it was not the caller's to remove, the saved-view shape, so
 * the route answers 404 rather than pretending a no-op succeeded.
 */
export async function deleteTemplate(
  userId: string,
  templateId: number
): Promise<boolean> {
  try {
    await requireTemplateRole(userId, templateId, "member");
  } catch (error) {
    if (error instanceof AuthzError && error.kind === "not_found") return false;
    throw error;
  }
  await query(`DELETE FROM task_template WHERE id = $1`, [templateId]);
  return true;
}
