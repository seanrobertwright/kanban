import type { Attachment } from "../types";

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(
      (body as { error?: string } | null)?.error ??
        `Request failed (${res.status})`
    );
  }
  return res.json() as Promise<T>;
}

export function fetchAttachments(taskId: number): Promise<Attachment[]> {
  return fetch(`/api/tasks/${taskId}/attachments`, { cache: "no-store" }).then(
    (res) => jsonOrThrow<Attachment[]>(res)
  );
}

/** Multipart, not JSON — the body is the file itself under the `file` field. */
export function uploadAttachment(
  taskId: number,
  file: File
): Promise<Attachment> {
  const form = new FormData();
  form.append("file", file);
  return fetch(`/api/tasks/${taskId}/attachments`, {
    method: "POST",
    body: form,
  }).then((res) => jsonOrThrow<Attachment>(res));
}

export async function deleteAttachment(id: number): Promise<void> {
  const res = await fetch(`/api/attachments/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(
      (body as { error?: string } | null)?.error ?? `Delete failed (${res.status})`
    );
  }
}

/** A plain href — the download route streams the bytes with the right headers. */
export function attachmentDownloadUrl(id: number): string {
  return `/api/attachments/${id}/download`;
}
