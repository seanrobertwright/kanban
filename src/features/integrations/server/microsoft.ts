import { queryOne } from "@/shared/db/client";
import { AuthzError, requireTaskRole } from "@/features/workspaces/server/authz";
import { microsoftAccessToken } from "./repository";
import type { TaskIntegrationLink } from "./google";

const LINK_COLUMNS = `id, task_id AS "taskId", provider, external_id AS "externalId", url, name, metadata, created_at AS "createdAt", updated_at AS "updatedAt"`;
function shareId(url: string): string | null { try { const parsed = new URL(url); if (parsed.protocol !== "https:" || !/(^|\.)(sharepoint\.com|onedrive\.com|1drv\.ms)$/i.test(parsed.hostname)) return null; return `u!${Buffer.from(parsed.toString()).toString("base64url")}`; } catch { return null; } }
async function taskWorkspace(userId: string, taskId: number): Promise<{ workspaceId: string }> { await requireTaskRole(userId, taskId, "member"); const row = await queryOne<{ workspaceId: string }>(`SELECT b.workspace_id AS "workspaceId" FROM task t JOIN board_column c ON c.id=t.column_id JOIN board b ON b.id=c.board_id WHERE t.id=$1`, [taskId]); if (!row) throw new AuthzError("not_found", "Task not found"); return row; }

export async function linkMicrosoftDriveItem(userId: string, taskId: number, url: string): Promise<TaskIntegrationLink> {
  const shared = shareId(url); if (!shared) throw new AuthzError("conflict", "Enter a valid OneDrive or SharePoint sharing URL");
  const { workspaceId } = await taskWorkspace(userId, taskId); const token = await microsoftAccessToken(workspaceId);
  const response = await fetch(`https://graph.microsoft.com/v1.0/shares/${encodeURIComponent(shared)}/driveItem?$select=id,name,webUrl,parentReference`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) });
  const item = await response.json().catch(() => null) as { id?: string; name?: string; webUrl?: string; parentReference?: { driveId?: string; siteId?: string } } | null;
  if (!response.ok || !item?.id || !item.name || !item.webUrl) throw new AuthzError("conflict", "Microsoft Graph could not read that OneDrive or SharePoint item");
  const externalId = `${item.parentReference?.driveId ?? "shared"}:${item.id}`;
  return (await queryOne<TaskIntegrationLink>(`INSERT INTO integration_link(task_id,provider,external_id,url,name,metadata,created_by) VALUES($1,'microsoft',$2,$3,$4,$5,$6) ON CONFLICT(task_id,provider,external_id) DO UPDATE SET url=EXCLUDED.url,name=EXCLUDED.name,metadata=EXCLUDED.metadata,updated_at=now() RETURNING ${LINK_COLUMNS}`,
    [taskId, externalId, item.webUrl, item.name.slice(0, 500), JSON.stringify({ kind: "drive", driveId: item.parentReference?.driveId, siteId: item.parentReference?.siteId }), userId]))!;
}

export async function syncMicrosoftCalendar(userId: string, taskId: number): Promise<TaskIntegrationLink> {
  await requireTaskRole(userId, taskId, "member");
  const task = await queryOne<{ workspaceId: string; title: string; description: string | null; startDate: string | null; dueDate: string | null }>(`SELECT b.workspace_id AS "workspaceId",t.title,t.description,t.start_date AS "startDate",t.due_date AS "dueDate" FROM task t JOIN board_column c ON c.id=t.column_id JOIN board b ON b.id=c.board_id WHERE t.id=$1`, [taskId]);
  if (!task) throw new AuthzError("not_found", "Task not found"); if (!task.startDate && !task.dueDate) throw new AuthzError("conflict", "Set a task start or due date before syncing it to Outlook Calendar");
  const start = new Date(task.startDate ?? task.dueDate!); const proposedEnd = task.dueDate ? new Date(task.dueDate) : new Date(start.getTime() + 60 * 60 * 1000); const end = proposedEnd > start ? proposedEnd : new Date(start.getTime() + 60 * 60 * 1000);
  const existing = await queryOne<{ externalId: string }>(`SELECT external_id AS "externalId" FROM integration_link WHERE task_id=$1 AND provider='microsoft' AND metadata->>'kind'='calendar'`, [taskId]);
  const token = await microsoftAccessToken(task.workspaceId); const event = { subject: task.title.slice(0, 255), body: { contentType: "text", content: task.description ?? "" }, start: { dateTime: start.toISOString().replace("Z", ""), timeZone: "UTC" }, end: { dateTime: end.toISOString().replace("Z", ""), timeZone: "UTC" }, transactionId: `kanban-${taskId}` };
  const response = await fetch(existing ? `https://graph.microsoft.com/v1.0/me/events/${encodeURIComponent(existing.externalId)}` : "https://graph.microsoft.com/v1.0/me/calendar/events", { method: existing ? "PATCH" : "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", Prefer: 'outlook.timezone="UTC"' }, body: JSON.stringify(event), signal: AbortSignal.timeout(10_000) });
  const created = await response.json().catch(() => null) as { id?: string; webLink?: string } | null;
  if (!response.ok || !created?.id || !created.webLink) throw new Error("Outlook Calendar sync failed");
  return (await queryOne<TaskIntegrationLink>(`INSERT INTO integration_link(task_id,provider,external_id,url,name,metadata,created_by) VALUES($1,'microsoft',$2,$3,$4,$5,$6) ON CONFLICT(task_id,provider,external_id) DO UPDATE SET url=EXCLUDED.url,name=EXCLUDED.name,metadata=EXCLUDED.metadata,updated_at=now() RETURNING ${LINK_COLUMNS}`,
    [taskId, created.id, created.webLink, task.title.slice(0, 500), JSON.stringify({ kind: "calendar", start: start.toISOString(), end: end.toISOString() }), userId]))!;
}
