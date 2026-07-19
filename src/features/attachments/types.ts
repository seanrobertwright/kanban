/**
 * A file on a task (021). Metadata only — the bytes live in object storage,
 * addressed by a key the client never sees; downloads go through the app, which
 * authorizes each one, so there is no public URL to carry here.
 *
 * `size` is a number: node-postgres hands BIGINT back as a string, so the
 * repository casts it, and a file over 2^53 bytes is not a case a task attachment
 * has. `uploadedBy` is the user id or null (the uploader may have left — 021's
 * SET NULL); the section resolves a name from the member list it already holds.
 */
export interface Attachment {
  id: number;
  taskId: number;
  name: string;
  contentType: string;
  size: number;
  uploadedBy: string | null;
  createdAt: string;
}

/**
 * The largest file the app accepts, enforced at the handler (a 400) before a byte
 * reaches the store. 25 MiB is generous for the docs, images, and logs a task
 * carries and small enough that buffering one in the upload handler is fine.
 */
export const ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;
