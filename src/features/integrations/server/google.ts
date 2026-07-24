import { query, queryOne } from "@/shared/db/client";
import { AuthzError, requireTaskRole } from "@/features/workspaces/server/authz";
import { googleAccessToken } from "./repository";

export interface TaskIntegrationLink { id: number; taskId: number; provider: "google" | "microsoft"; externalId: string; url: string; name: string; metadata: Record<string, unknown>; createdAt: string; updatedAt: string; }
const LINK_COLUMNS = `id, task_id AS "taskId", provider, external_id AS "externalId", url, name, metadata, created_at AS "createdAt", updated_at AS "updatedAt"`;

function driveFileId(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || !/(^|\.)google\.com$/i.test(parsed.hostname)) return null;
    const id = parsed.pathname.match(/\/d\/([A-Za-z0-9_-]{10,})/)?.[1] ?? parsed.searchParams.get("id");
    return id && /^[A-Za-z0-9_-]{10,}$/.test(id) ? id : null;
  } catch { return null; }
}

async function taskWorkspace(userId: string, taskId: number): Promise<{ workspaceId: string }> {
  await requireTaskRole(userId, taskId, "member");
  const row = await queryOne<{ workspaceId: string }>(`SELECT b.workspace_id AS "workspaceId" FROM task t JOIN board_column c ON c.id=t.column_id JOIN board b ON b.id=c.board_id WHERE t.id=$1`, [taskId]);
  if (!row) throw new AuthzError("not_found", "Task not found");
  return row;
}

export async function listTaskIntegrationLinks(userId: string, taskId: number): Promise<TaskIntegrationLink[]> {
  await requireTaskRole(userId, taskId, "viewer");
  return query<TaskIntegrationLink>(`SELECT ${LINK_COLUMNS} FROM integration_link WHERE task_id=$1 ORDER BY created_at DESC`, [taskId]);
}

export async function linkGoogleDriveFile(userId: string, taskId: number, driveUrl: string): Promise<TaskIntegrationLink> {
  const fileId = driveFileId(driveUrl); if (!fileId) throw new AuthzError("conflict", "Enter a valid Google Drive file URL");
  const { workspaceId } = await taskWorkspace(userId, taskId);
  const token = await googleAccessToken(workspaceId);
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,webViewLink`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) });
  const file = await response.json().catch(() => null) as { id?: string; name?: string; mimeType?: string; webViewLink?: string } | null;
  if (!response.ok || !file?.id || !file.name || !file.webViewLink) throw new AuthzError("conflict", "Google Drive could not read that file; check sharing permissions");
  return (await queryOne<TaskIntegrationLink>(
    `INSERT INTO integration_link(task_id,provider,external_id,url,name,metadata,created_by) VALUES($1,'google',$2,$3,$4,$5,$6)
     ON CONFLICT(task_id,provider,external_id) DO UPDATE SET url=EXCLUDED.url,name=EXCLUDED.name,metadata=EXCLUDED.metadata,updated_at=now()
     RETURNING ${LINK_COLUMNS}`,
    [taskId, file.id, file.webViewLink, file.name.slice(0, 500), JSON.stringify({ kind: "drive", mimeType: file.mimeType }), userId]
  ))!;
}

export async function syncGoogleCalendar(userId: string, taskId: number): Promise<TaskIntegrationLink> {
  await requireTaskRole(userId, taskId, "member");
  const task = await queryOne<{ workspaceId: string; title: string; description: string | null; startDate: string | null; dueDate: string | null }>(
    `SELECT b.workspace_id AS "workspaceId",t.title,t.description,t.start_date AS "startDate",t.due_date AS "dueDate" FROM task t JOIN board_column c ON c.id=t.column_id JOIN board b ON b.id=c.board_id WHERE t.id=$1`, [taskId]
  );
  if (!task) throw new AuthzError("not_found", "Task not found");
  if (!task.startDate && !task.dueDate) throw new AuthzError("conflict", "Set a task start or due date before syncing it to Google Calendar");
  const start = new Date(task.startDate ?? task.dueDate!); const proposedEnd = task.dueDate ? new Date(task.dueDate) : new Date(start.getTime() + 60 * 60 * 1000);
  const end = proposedEnd > start ? proposedEnd : new Date(start.getTime() + 60 * 60 * 1000);
  const existing = await queryOne<{ externalId: string }>(`SELECT external_id AS "externalId" FROM integration_link WHERE task_id=$1 AND provider='google' AND metadata->>'kind'='calendar'`, [taskId]);
  const eventId = existing?.externalId ?? `kanban${taskId}`;
  const token = await googleAccessToken(task.workspaceId);
  const event = { id: eventId, summary: task.title.slice(0, 1024), description: task.description ?? "", start: { dateTime: start.toISOString() }, end: { dateTime: end.toISOString() }, extendedProperties: { private: { kanbanTaskId: String(taskId) } } };
  const endpoint = `https://www.googleapis.com/calendar/v3/calendars/primary/events${existing ? `/${encodeURIComponent(eventId)}` : ""}?sendUpdates=none`;
  const response = await fetch(endpoint, { method: existing ? "PUT" : "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(event), signal: AbortSignal.timeout(10_000) });
  const created = await response.json().catch(() => null) as { id?: string; htmlLink?: string } | null;
  if (!response.ok || !created?.id || !created.htmlLink) throw new Error("Google Calendar sync failed");
  return (await queryOne<TaskIntegrationLink>(
    `INSERT INTO integration_link(task_id,provider,external_id,url,name,metadata,created_by) VALUES($1,'google',$2,$3,$4,$5,$6)
     ON CONFLICT(task_id,provider,external_id) DO UPDATE SET url=EXCLUDED.url,name=EXCLUDED.name,metadata=EXCLUDED.metadata,updated_at=now()
     RETURNING ${LINK_COLUMNS}`,
    [taskId, created.id, created.htmlLink, task.title.slice(0, 500), JSON.stringify({ kind: "calendar", start: start.toISOString(), end: end.toISOString() }), userId]
  ))!;
}
