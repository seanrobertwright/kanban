import type { PoolClient } from "pg";
import crypto from "node:crypto";

import type { Principal } from "@/features/auth/server/principal";
import { query, queryOne, withTransaction } from "@/shared/db/client";
import { AuthzError, requireWorkspaceRole } from "@/features/workspaces/server/authz";
import { createTask } from "@/features/tasks/server/repository";
import type { Task } from "@/features/tasks/types";
import type { CreateDocInput, Doc, DocRevision, UpdateDocInput } from "../types";
import { extractMeetingActions } from "../lib/meeting-actions";

const DOC_COLUMNS = `id, workspace_id AS "workspaceId", board_id AS "boardId",
  parent_id AS "parentId", title, body, kind, position,
  is_published AS "isPublished", created_by AS "createdBy",
  created_at AS "createdAt", updated_at AS "updatedAt"`;

async function selectDoc(client: PoolClient, id: number): Promise<Doc | undefined> {
  const { rows } = await client.query<Doc>(`SELECT ${DOC_COLUMNS} FROM doc WHERE id = $1`, [id]);
  return rows[0];
}

async function requireDoc(actor: string | Principal, id: number, min: "viewer" | "member" | "admin") {
  const row = await queryOne<{ workspaceId: string }>(
    `SELECT workspace_id AS "workspaceId" FROM doc WHERE id = $1`, [id]
  );
  if (!row) throw new AuthzError("not_found", "Document not found");
  // Guests are members of a workspace only so an administrator can address
  // them. They see a document solely through an explicit object share.
  if (typeof actor === "string") {
    const membership = await queryOne<{ role: string }>(`SELECT role FROM workspace_member WHERE workspace_id=$1 AND user_id=$2`, [row.workspaceId, actor]);
    if (membership?.role === "guest") {
      const share = await queryOne<{ canEdit: boolean }>(`SELECT can_edit AS "canEdit" FROM object_share WHERE subject_type='doc' AND subject_id=$1 AND user_id=$2`, [String(id), actor]);
      if (!share || (min !== "viewer" && !share.canEdit)) throw new AuthzError("not_found", "Document not found");
      return row;
    }
  }
  await requireWorkspaceRole(actor, row.workspaceId, min);
  return row;
}

/** Guests never inherit workspace visibility. A guest can read only a doc with
 * an explicit object_share row; edit also needs can_edit. */
export async function requireSharedDoc(userId: string, id: number, edit = false): Promise<Doc> {
  const doc = await queryOne<Doc>(`SELECT ${DOC_COLUMNS} FROM doc WHERE id=$1`, [id]);
  if (!doc) throw new AuthzError("not_found", "Document not found");
  const share = await queryOne<{ canEdit: boolean }>(`SELECT can_edit AS "canEdit" FROM object_share WHERE subject_type='doc' AND subject_id=$1 AND user_id=$2`, [String(id), userId]);
  if (!share || (edit && !share.canEdit)) throw new AuthzError("not_found", "Document not found");
  return doc;
}

export async function getPublicDoc(token: string): Promise<Doc> {
  const doc = await queryOne<Doc>(`SELECT d.id, d.workspace_id AS "workspaceId", d.board_id AS "boardId", d.parent_id AS "parentId", d.title, d.body, d.kind, d.position, d.is_published AS "isPublished", d.created_by AS "createdBy", d.created_at AS "createdAt", d.updated_at AS "updatedAt" FROM public_link p JOIN doc d ON d.id=p.subject_id::int WHERE p.token=$1 AND p.subject_type='doc' AND p.scope='read' AND (p.expires_at IS NULL OR p.expires_at > now())`, [token]);
  if (!doc) throw new AuthzError("not_found", "Public document not found");
  return doc;
}

/** Promote one checked/unchecked meeting action into board work. Meeting docs
 * without a board are intentionally refused: there is no implicit destination. */
export async function promoteMeetingAction(userId: string, id: number, title: string): Promise<Task> {
  await requireDoc(userId, id, "member");
  const doc = await queryOne<Doc>(`SELECT ${DOC_COLUMNS} FROM doc WHERE id=$1`, [id]);
  if (!doc) throw new AuthzError("not_found", "Document not found");
  if (doc.kind !== "meeting" || doc.boardId == null) throw new AuthzError("conflict", "Only a board meeting note can promote an action item");
  const column = await queryOne<{ id: number }>(`SELECT id FROM board_column WHERE board_id=$1 ORDER BY position,id LIMIT 1`, [doc.boardId]);
  if (!column) throw new AuthzError("not_found", "This board has no column");
  return createTask(userId, { columnId: column.id, title: title.trim(), description: `Promoted from meeting note: ${doc.title}` });
}

export async function extractActionsFromMeeting(userId: string, id: number) {
  await requireDoc(userId, id, "viewer"); const doc = await queryOne<Doc>(`SELECT ${DOC_COLUMNS} FROM doc WHERE id=$1`, [id]);
  if (!doc || doc.kind !== "meeting") throw new AuthzError("conflict", "Only meeting notes have action items");
  return extractMeetingActions(doc.body);
}

async function assertParent(client: PoolClient, workspaceId: string, parentId: number | null) {
  if (parentId === null) return;
  const { rows } = await client.query(`SELECT 1 FROM doc WHERE id = $1 AND workspace_id = $2`, [parentId, workspaceId]);
  if (rows.length === 0) throw new AuthzError("not_found", "Parent document not found");
}

async function assertBoard(client: PoolClient, workspaceId: string, boardId: number | null) {
  if (boardId === null) return;
  const { rows } = await client.query(`SELECT 1 FROM board WHERE id = $1 AND workspace_id = $2`, [boardId, workspaceId]);
  if (rows.length === 0) throw new AuthzError("not_found", "Board not found");
}

export async function listDocs(actor: string | Principal, workspaceId: string, queryText?: string): Promise<Doc[]> {
  await requireWorkspaceRole(actor, workspaceId, "viewer");
  const term = queryText?.trim();
  return query<Doc>(
    term
      ? `SELECT ${DOC_COLUMNS} FROM doc WHERE workspace_id = $1 AND is_published
           AND to_tsvector('simple', title || ' ' || body) @@ plainto_tsquery('simple', $2)
           ORDER BY updated_at DESC, id`
      : `SELECT ${DOC_COLUMNS} FROM doc WHERE workspace_id = $1 ORDER BY parent_id NULLS FIRST, position, id`,
    term ? [workspaceId, term] : [workspaceId]
  );
}

export async function createDoc(userId: string, workspaceId: string, input: CreateDocInput): Promise<Doc> {
  await requireWorkspaceRole(userId, workspaceId, "member");
  return withTransaction(async (client) => {
    const parentId = input.parentId ?? null;
    const boardId = input.boardId ?? null;
    await assertParent(client, workspaceId, parentId);
    await assertBoard(client, workspaceId, boardId);
    const { rows } = await client.query<{ id: number }>(
      `INSERT INTO doc (workspace_id, board_id, parent_id, title, body, kind, position, is_published, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,(SELECT COALESCE(MAX(position)+1,0) FROM doc WHERE workspace_id=$1 AND parent_id IS NOT DISTINCT FROM $3),$7,$8)
       RETURNING id`,
      [workspaceId, boardId, parentId, input.title.trim(), input.body ?? "", input.kind ?? "page", input.isPublished ?? false, userId]
    );
    return (await selectDoc(client, rows[0].id))!;
  });
}

export async function updateDoc(userId: string, id: number, input: UpdateDocInput): Promise<Doc | undefined> {
  const { workspaceId } = await requireDoc(userId, id, "member");
  return withTransaction(async (client) => {
    const before = await selectDoc(client, id);
    if (!before) return undefined;
    const setsParent = "parentId" in input;
    const setsBoard = "boardId" in input;
    if (setsParent) {
      if (input.parentId === id) throw new AuthzError("conflict", "A document cannot be its own parent");
      await assertParent(client, workspaceId, input.parentId ?? null);
    }
    if (setsBoard) await assertBoard(client, workspaceId, input.boardId ?? null);
    if (input.body !== undefined && input.body !== before.body) {
      await client.query(`INSERT INTO doc_revision (doc_id, body, edited_by) VALUES ($1,$2,$3)`, [id, before.body, userId]);
    }
    await client.query(
      `UPDATE doc SET title=COALESCE($2,title), body=COALESCE($3,body), kind=COALESCE($4,kind),
       board_id=CASE WHEN $5::boolean THEN $6 ELSE board_id END,
       parent_id=CASE WHEN $7::boolean THEN $8 ELSE parent_id END,
       position=COALESCE($9,position), is_published=COALESCE($10,is_published), updated_at=now() WHERE id=$1`,
      [id, input.title?.trim() ?? null, input.body ?? null, input.kind ?? null, setsBoard, input.boardId ?? null, setsParent, input.parentId ?? null, input.position ?? null, input.isPublished ?? null]
    );
    return (await selectDoc(client, id))!;
  });
}

export async function deleteDoc(userId: string, id: number): Promise<boolean> {
  await requireDoc(userId, id, "admin");
  await query(`DELETE FROM doc WHERE id = $1`, [id]);
  return true;
}

export async function listDocRevisions(actor: string | Principal, id: number): Promise<DocRevision[]> {
  await requireDoc(actor, id, "viewer");
  return query<DocRevision>(`SELECT id, doc_id AS "docId", body, edited_by AS "editedBy", created_at AS "createdAt" FROM doc_revision WHERE doc_id=$1 ORDER BY created_at DESC,id DESC`, [id]);
}

/** Short lived, document-scoped ticket for the separate Yjs service. The socket
 * service verifies this HMAC and then rechecks live workspace membership. */
export async function issueCollaborationTicket(userId: string, id: number): Promise<string> {
  await requireDoc(userId, id, "viewer");
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("BETTER_AUTH_SECRET is not configured");
  const payload = Buffer.from(JSON.stringify({ docId: id, userId, exp: Date.now() + 60_000 })).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}
