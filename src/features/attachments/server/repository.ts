import { randomUUID } from "node:crypto";

import { query } from "@/shared/db/client";
import { AuthzError, requireTaskRole } from "@/features/workspaces/server/authz";
import type { Principal } from "@/features/auth/server/principal";
import type { Attachment } from "../types";
import { deleteObject, getObjectStream, putObject } from "./storage";

const ATTACHMENT_COLUMNS = `id, task_id AS "taskId", name, content_type AS "contentType",
                            size::int AS size, uploaded_by AS "uploadedBy",
                            created_at AS "createdAt"`;

/**
 * Resolves an attachment id to its task and checks the caller's role on it, or
 * 404 — "no such attachment" and "an attachment on a task you cannot reach" are
 * one answer (M0's rule), so the id space is not an oracle. The checklist's
 * requireItemRole, one table over.
 */
async function requireAttachmentRole(
  actor: string | Principal,
  attachmentId: number,
  role: "viewer" | "member"
): Promise<{ taskId: number; key: string }> {
  const rows = await query<{ taskId: number; key: string }>(
    `SELECT task_id AS "taskId", key FROM attachment WHERE id = $1`,
    [attachmentId]
  );
  const row = rows[0];
  if (!row) throw new AuthzError("not_found", "Attachment not found");
  await requireTaskRole(actor, row.taskId, role);
  return row;
}

/** A task's files, newest first. Viewer is enough — reading is not attaching. */
export async function listAttachments(
  actor: string | Principal,
  taskId: number
): Promise<Attachment[]> {
  await requireTaskRole(actor, taskId, "viewer");
  return query<Attachment>(
    `SELECT ${ATTACHMENT_COLUMNS} FROM attachment
      WHERE task_id = $1 ORDER BY created_at DESC, id DESC`,
    [taskId]
  );
}

/**
 * Stores a file: the object first, then the row that names it.
 *
 * "member": attaching a file is a board mutation, the rank createTask asks. The
 * object goes up before the row so the row never points at bytes that are not
 * there; if the INSERT then fails, the object is swept back off (best-effort) so
 * a failed upload leaves nothing behind. The key is opaque — a uuid under the
 * task's prefix — so the original filename, kept in `name`, can never collide or
 * escape its prefix (021).
 */
export async function createAttachment(
  userId: string,
  taskId: number,
  file: { name: string; contentType: string; size: number; body: Uint8Array }
): Promise<Attachment> {
  await requireTaskRole(userId, taskId, "member");

  const key = `tasks/${taskId}/${randomUUID()}`;
  await putObject(key, file.body, file.contentType);

  try {
    const rows = await query<Attachment>(
      `INSERT INTO attachment (task_id, key, name, content_type, size, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING ${ATTACHMENT_COLUMNS}`,
      [taskId, key, file.name, file.contentType, file.size, userId]
    );
    return rows[0];
  } catch (error) {
    // The row did not land, so the object it would have named is an orphan — take
    // it back off. Best-effort: a failed cleanup is a leak, not a second failure
    // to surface over the first.
    await deleteObject(key).catch(() => {});
    throw error;
  }
}

/**
 * Opens an attachment for download — its bytes as a stream plus the headers a
 * browser needs to name and type the file. Viewer, matching the list: reading a
 * task's file is reading the task. Undefined if it is gone, so the route 404s.
 */
export async function openAttachment(
  actor: string | Principal,
  attachmentId: number
): Promise<
  | { stream: ReadableStream; name: string; contentType: string; size: number }
  | undefined
> {
  let key: string;
  try {
    ({ key } = await requireAttachmentRole(actor, attachmentId, "viewer"));
  } catch (error) {
    if (error instanceof AuthzError && error.kind === "not_found") return undefined;
    throw error;
  }
  const meta = (
    await query<{ name: string; contentType: string; size: number }>(
      `SELECT name, content_type AS "contentType", size::int AS size
         FROM attachment WHERE id = $1`,
      [attachmentId]
    )
  )[0];
  const stream = await getObjectStream(key);
  return { stream, ...meta };
}

/**
 * Removes an attachment: the row first (the source of truth), then the object.
 *
 * Row-first is deliberate. A leftover object is a storage leak a sweep can
 * reclaim; a row whose object is already gone is a download that 404s. So the
 * record of existence goes first, and the bytes follow best-effort. Returns false
 * when it was not the caller's to remove, so the route 404s rather than pretend.
 */
export async function deleteAttachment(
  userId: string,
  attachmentId: number
): Promise<boolean> {
  let key: string;
  try {
    ({ key } = await requireAttachmentRole(userId, attachmentId, "member"));
  } catch (error) {
    if (error instanceof AuthzError && error.kind === "not_found") return false;
    throw error;
  }
  await query(`DELETE FROM attachment WHERE id = $1`, [attachmentId]);
  await deleteObject(key).catch(() => {});
  return true;
}
