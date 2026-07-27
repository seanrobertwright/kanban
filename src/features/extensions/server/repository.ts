import { query, queryOne } from "@/shared/db/client";
import { AuthzError, requireTaskRole, requireWorkspaceRole } from "@/features/workspaces/server/authz";
import { EXTENSION_SCOPES, readManifest, type ExtensionBoardView, type ExtensionLabelsView, type ExtensionScope, type ExtensionSlot, type ExtensionTaskView, type ExtensionView, type WorkspaceExtension } from "../types";
const COLUMNS = `id,workspace_id AS "workspaceId",name,url,capabilities,slots,installed_by AS "installedBy",created_at AS "createdAt",updated_at AS "updatedAt"`;
export async function listWorkspaceExtensions(userId: string, workspaceId: string): Promise<WorkspaceExtension[]> { await requireWorkspaceRole(userId, workspaceId, "viewer"); const rows = await query<WorkspaceExtension & { manifest: unknown }>(`SELECT ${COLUMNS},manifest FROM workspace_extension WHERE workspace_id=$1 ORDER BY name`, [workspaceId]); return rows.map(({ manifest, ...row }) => ({ ...row, ...(readManifest(manifest) ?? { name: row.name, url: row.url, capabilities: row.capabilities, slots: row.slots }) })); }
export async function installWorkspaceExtension(userId: string, workspaceId: string, manifestValue: unknown): Promise<WorkspaceExtension> { await requireWorkspaceRole(userId, workspaceId, "owner"); const manifest = readManifest(manifestValue); if (!manifest) throw new AuthzError("conflict", "Invalid extension manifest"); return (await queryOne<WorkspaceExtension>(`INSERT INTO workspace_extension(workspace_id,name,manifest,url,capabilities,slots,installed_by) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(workspace_id,name) DO UPDATE SET manifest=EXCLUDED.manifest,url=EXCLUDED.url,capabilities=EXCLUDED.capabilities,slots=EXCLUDED.slots,installed_by=EXCLUDED.installed_by,updated_at=now() RETURNING ${COLUMNS}`,[workspaceId,manifest.name,JSON.stringify(manifest),manifest.url,manifest.capabilities,manifest.slots,userId]))!; }
export async function removeWorkspaceExtension(userId: string, workspaceId: string, id: number): Promise<void> { await requireWorkspaceRole(userId, workspaceId, "owner"); const row=await queryOne<{id:number}>(`DELETE FROM workspace_extension WHERE id=$1 AND workspace_id=$2 RETURNING id`,[id,workspaceId]);if(!row)throw new AuthzError("not_found","Extension not found"); }
export async function listTaskSlotExtensions(userId: string, taskId: number, slot: ExtensionSlot): Promise<WorkspaceExtension[]> { const { workspaceId }=await requireTaskRole(userId,taskId,"viewer"); const rows=await query<WorkspaceExtension & {manifest:unknown}>(`SELECT ${COLUMNS},manifest FROM workspace_extension WHERE workspace_id=$1 AND $2=ANY(slots) ORDER BY name`,[workspaceId,slot]);return rows.map(({manifest,...row})=>({...row,...(readManifest(manifest)??{name:row.name,url:row.url,capabilities:row.capabilities,slots:row.slots})})); }
/**
 * The bridge: the only door from a sandboxed iframe to workspace data.
 *
 * Two gates, in this order and never one without the other. The **caller's**
 * board access (requireTaskRole) decides whether this data may leave the server
 * at all — an extension is never a way for a viewer to see a board they cannot
 * open. Then the **extension's** manifest capability decides whether this
 * particular iframe may have this particular projection. An extension granted
 * `task.read` asking for comments is a 403, not a smaller answer.
 *
 * Every arm returns a shape built here, not a row: no user ids or emails, no
 * internal columns, no card contents on the board arm. Adding a field to a
 * table must never silently widen what third-party code can read.
 */
export async function extensionTaskBridge(userId: string, taskId: number, extensionId: number, scope: ExtensionScope = "task"): Promise<ExtensionView> {
  const { workspaceId } = await requireTaskRole(userId, taskId, "viewer");
  const extension = await queryOne<{ capabilities: string[] }>(`SELECT capabilities FROM workspace_extension WHERE id=$1 AND workspace_id=$2`, [extensionId, workspaceId]);
  if (!extension) throw new AuthzError("not_found", "Extension not found");
  const capability = EXTENSION_SCOPES[scope];
  if (!extension.capabilities.includes(capability)) throw new AuthzError("forbidden", `Extension was not granted ${capability}`);

  if (scope === "task") {
    const task = await queryOne<ExtensionTaskView["task"]>(`SELECT id,title,description,due_date AS "dueDate",start_date AS "startDate" FROM task WHERE id=$1`, [taskId]);
    if (!task) throw new AuthzError("not_found", "Task not found");
    return { task };
  }

  if (scope === "comments") {
    // Author display names, never ids or email addresses: an extension renders
    // a discussion, it does not need to be able to address the participants.
    const comments = await query<{ id: number; body: string; createdAt: string; authorType: "human" | "agent"; authorName: string | null }>(
      `SELECT c.id, c.body, c.created_at AS "createdAt", c.author_type AS "authorType",
              COALESCE(u.name, a.name) AS "authorName"
         FROM comment c
         LEFT JOIN "user" u ON c.author_type='human' AND u.id = c.author_id
         LEFT JOIN agent a ON c.author_type='agent' AND a.id::text = c.author_id
        WHERE c.task_id=$1
        ORDER BY c.created_at, c.id`,
      [taskId]
    );
    return { comments: comments.map(({ authorType, authorName, ...rest }) => ({ ...rest, author: { type: authorType, name: authorName ?? "Unknown" } })) };
  }

  if (scope === "labels") {
    return { labels: await query<ExtensionLabelsView["labels"][number]>(`SELECT l.id, l.name, l.color FROM task_label tl JOIN label l ON l.id = tl.label_id WHERE tl.task_id=$1 ORDER BY lower(l.name)`, [taskId]) };
  }

  // board: structure and counts, not cards. A badge or panel wants to know
  // where this task sits and how loaded the columns are; handing over every
  // title on the board would make the bridge an export.
  const board = await queryOne<{ id: number; name: string; columnId: number }>(
    `SELECT b.id, b.name, t.column_id AS "columnId"
       FROM task t JOIN board_column c ON c.id = t.column_id JOIN board b ON b.id = c.board_id
      WHERE t.id=$1`,
    [taskId]
  );
  if (!board) throw new AuthzError("not_found", "Task not found");
  const columns = await query<ExtensionBoardView["columns"][number]>(
    `SELECT c.id, c.title, c.position,
            (SELECT count(*) FROM task t WHERE t.column_id = c.id AND t.parent_id IS NULL)::int AS "taskCount"
       FROM board_column c WHERE c.board_id=$1 ORDER BY c.position, c.id`,
    [board.id]
  );
  return { board, columns };
}
