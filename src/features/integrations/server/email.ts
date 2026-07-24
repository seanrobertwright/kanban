import { createHmac, timingSafeEqual } from "node:crypto";
import nodemailer from "nodemailer";
import { queryOne } from "@/shared/db/client";
import { createComment } from "@/features/comments/server/repository";
import { createTask } from "@/features/tasks/server/repository";

const EMAIL_MAX_BODY = 100_000;

function inboundSecret(): string {
  const secret = process.env.EMAIL_INBOUND_SIGNING_SECRET;
  if (!secret) throw new Error("EMAIL_INBOUND_SIGNING_SECRET is not configured");
  return secret;
}

function inboundDomain(): string {
  const domain = process.env.EMAIL_INBOUND_DOMAIN?.trim().toLowerCase();
  if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) throw new Error("EMAIL_INBOUND_DOMAIN is not configured");
  return domain;
}

/** The board address is unguessable without the deployment secret and needs no
 * mutable token row. Rotating EMAIL_INBOUND_SIGNING_SECRET invalidates every
 * inbound address, so that operational consequence is documented. */
export function inboundAddress(boardId: number): string {
  const token = createHmac("sha256", inboundSecret()).update(`board:${boardId}`).digest("base64url").slice(0, 24);
  return `board-${boardId}-${token}@${inboundDomain()}`;
}

function safeMailbox(value: string): boolean {
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value) && !/[\r\n]/.test(value);
}

function plainText(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\nOn .+wrote:\n[\s\S]*$/i, "").replace(/\n>{1,}.*$/gm, "").trim().slice(0, EMAIL_MAX_BODY);
}

export async function sendWorkspaceEmail(input: { workspaceId: string; boardId: number; taskId: number; to: string; text: string }): Promise<void> {
  if (!safeMailbox(input.to)) throw new Error("Invalid notification email address");
  const url = process.env.SMTP_URL;
  const from = process.env.SMTP_FROM;
  if (!url || !from || !safeMailbox(from)) throw new Error("SMTP_URL and SMTP_FROM must be configured before email delivery");
  const transporter = nodemailer.createTransport(url);
  await transporter.sendMail({
    from,
    to: input.to,
    subject: `Kanban task #${input.taskId}`,
    text: input.text.slice(0, EMAIL_MAX_BODY),
    replyTo: inboundAddress(input.boardId),
    headers: { "X-Kanban-Workspace": input.workspaceId, "X-Kanban-Task": String(input.taskId) },
  });
}

interface InboundMessage { to?: string; from?: string; subject?: string; text?: string; html?: string; }

function verifiedSignature(headers: Headers, raw: string): boolean {
  const timestamp = headers.get("x-kanban-email-timestamp");
  const signature = headers.get("x-kanban-email-signature");
  if (!timestamp || !signature || !/^v1=[a-f0-9]{64}$/.test(signature)) return false;
  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds) || Math.abs(Date.now() / 1000 - seconds) > 300) return false;
  const expected = `v1=${createHmac("sha256", inboundSecret()).update(`${timestamp}.${raw}`).digest("hex")}`;
  return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

function boardFromRecipient(to: string): number | null {
  const match = to.trim().toLowerCase().match(/^board-(\d+)-([a-z0-9_-]{24})@([a-z0-9.-]+)$/i);
  if (!match || match[3] !== inboundDomain()) return null;
  const boardId = Number(match[1]);
  return Number.isInteger(boardId) && timingSafeEqual(Buffer.from(to.trim().toLowerCase()), Buffer.from(inboundAddress(boardId))) ? boardId : null;
}

/** Generic inbound gateway contract: POST JSON `{to,from,subject,text,html}`
 * with x-kanban-email-timestamp and `v1=HMAC_SHA256(timestamp + '.' + raw)`.
 * A gateway authenticates here; email body fields are never trusted for identity. */
export async function handleInboundEmail(request: Request): Promise<Response> {
  const raw = await request.text();
  if (raw.length > EMAIL_MAX_BODY * 2) return Response.json({ error: "Message is too large" }, { status: 413 });
  if (!verifiedSignature(request.headers, raw)) return Response.json({ error: "Invalid inbound email signature" }, { status: 401 });
  const message = JSON.parse(raw) as InboundMessage;
  if (!message || !message.to || !message.from || !message.subject || (!message.text && !message.html) || !safeMailbox(message.from)) {
    return Response.json({ error: "Invalid inbound email payload" }, { status: 400 });
  }
  const boardId = boardFromRecipient(message.to);
  if (!boardId) return Response.json({ error: "Unknown board recipient" }, { status: 404 });
  const actor = await queryOne<{ userId: string; workspaceId: string }>(
    `SELECT u.id AS "userId", b.workspace_id AS "workspaceId" FROM board b
      JOIN workspace_member wm ON wm.workspace_id=b.workspace_id JOIN "user" u ON u.id=wm.user_id
     WHERE b.id=$1 AND lower(u.email)=lower($2)`, [boardId, message.from]
  );
  if (!actor) return Response.json({ error: "Sender is not a workspace member" }, { status: 403 });
  const body = plainText(message.text || message.html!.replace(/<[^>]+>/g, " "));
  if (!body) return Response.json({ error: "Message has no usable text" }, { status: 400 });
  const reply = message.subject.match(/^\s*(?:re:\s*)?\[?task\s*#(\d+)\]?/i);
  if (reply) {
    const taskId = Number(reply[1]);
    await createComment(actor.userId, { taskId, body });
    return Response.json({ kind: "comment", taskId }, { status: 201 });
  }
  const column = await queryOne<{ id: number }>(`SELECT id FROM board_column WHERE board_id=$1 ORDER BY position LIMIT 1`, [boardId]);
  if (!column) return Response.json({ error: "Board has no columns" }, { status: 409 });
  const task = await createTask(actor.userId, { columnId: column.id, title: message.subject.trim().replace(/^\[.*?\]\s*/, "").slice(0, 500), description: body });
  return Response.json({ kind: "task", taskId: task.id }, { status: 201 });
}
