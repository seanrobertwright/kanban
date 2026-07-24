import { createHmac, timingSafeEqual } from "node:crypto";
import { queryOne } from "@/shared/db/client";
import { createTask } from "@/features/tasks/server/repository";
import { postSlackUnfurl } from "./repository";

function verifySignature(headers: Headers, rawBody: string): boolean {
  const secret = process.env.SLACK_SIGNING_SECRET;
  const timestamp = headers.get("x-slack-request-timestamp");
  const signature = headers.get("x-slack-signature");
  if (!secret || !timestamp || !signature || !/^v0=[a-f0-9]{64}$/.test(signature)) return false;
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > 300) return false;
  const expected = `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${rawBody}`).digest("hex")}`;
  return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

export async function handleSlackCommand(request: Request): Promise<Response> {
  const raw = await request.text();
  if (!verifySignature(request.headers, raw)) return Response.json({ error: "Invalid Slack signature" }, { status: 401 });
  const data = new URLSearchParams(raw);
  const teamId = data.get("team_id"); const text = data.get("text")?.trim();
  if (!teamId || !text) return Response.json({ response_type: "ephemeral", text: "Usage: /task create <title>" });
  const match = text.match(/^create\s+(.+)$/i);
  if (!match) return Response.json({ response_type: "ephemeral", text: "Usage: /task create <title>" });
  const connection = await queryOne<{ workspaceId: string; createdBy: string }>(
    `SELECT workspace_id AS "workspaceId", created_by AS "createdBy" FROM integration_connection
      WHERE provider='slack' AND external_id=$1 LIMIT 1`, [teamId]
  );
  if (!connection) return Response.json({ response_type: "ephemeral", text: "This Slack workspace is not connected." });
  const column = await queryOne<{ id: number }>(
    `SELECT c.id FROM board b JOIN board_column c ON c.board_id=b.id
      WHERE b.workspace_id=$1 ORDER BY b.position, c.position LIMIT 1`, [connection.workspaceId]
  );
  if (!column) return Response.json({ response_type: "ephemeral", text: "No board column is available for this workspace." });
  const task = await createTask(connection.createdBy, { columnId: column.id, title: match[1].slice(0, 500) });
  return Response.json({ response_type: "in_channel", text: `Created task #${task.id}: ${task.title}` });
}

export async function handleSlackEvent(request: Request): Promise<Response> {
  const raw = await request.text();
  if (!verifySignature(request.headers, raw)) return Response.json({ error: "Invalid Slack signature" }, { status: 401 });
  const payload = JSON.parse(raw) as { type?: string; challenge?: string; team_id?: string; event?: { type?: string; channel?: string; links?: Array<{ url?: string }> } };
  if (payload.type === "url_verification" && typeof payload.challenge === "string") return Response.json({ challenge: payload.challenge });
  if (payload.type === "event_callback" && payload.event?.type === "link_shared" && payload.team_id && payload.event.channel) {
    const connection = await queryOne<{ workspaceId: string }>(`SELECT workspace_id AS "workspaceId" FROM integration_connection WHERE provider='slack' AND external_id=$1`, [payload.team_id]);
    if (!connection) return new Response(null, { status: 204 });
    const unfurls: Record<string, { text: string }> = {};
    for (const link of payload.event.links ?? []) {
      const url = link.url; if (!url) continue;
      const taskId = url.match(/(?:tasks?|task)\/(\d+)(?:$|[/?#])/)?.[1] ?? new URL(url).searchParams.get("taskId");
      if (!taskId || !/^\d+$/.test(taskId)) continue;
      const task = await queryOne<{ id: number; title: string; priority: string; dueDate: string | null }>(`SELECT t.id,t.title,t.priority,t.due_date AS "dueDate" FROM task t JOIN board_column c ON c.id=t.column_id JOIN board b ON b.id=c.board_id WHERE t.id=$1 AND b.workspace_id=$2`, [Number(taskId), connection.workspaceId]);
      if (task) unfurls[url] = { text: `*Task #${task.id}: ${task.title}*\nPriority: ${task.priority}${task.dueDate ? ` · Due: ${task.dueDate}` : ""}` };
    }
    if (Object.keys(unfurls).length) await postSlackUnfurl(connection.workspaceId, payload.event.channel, unfurls);
  }
  return new Response(null, { status: 204 });
}
