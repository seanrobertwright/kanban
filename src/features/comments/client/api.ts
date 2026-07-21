import type { Comment, CommentEntry } from "../types";

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(
      (body as { error?: string } | null)?.error ?? `Request failed (${res.status})`
    );
  }
  return res.json() as Promise<T>;
}

export async function fetchTaskComments(taskId: number): Promise<CommentEntry[]> {
  const res = await fetch(`/api/tasks/${taskId}/comments`, {
    cache: "no-store",
  });
  return jsonOrThrow<CommentEntry[]>(res);
}

/** Post a comment, or a reply under `parentId` (033) when one is given. */
export function createComment(
  taskId: number,
  body: string,
  parentId?: number
): Promise<Comment> {
  return fetch(`/api/tasks/${taskId}/comments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(parentId === undefined ? { body } : { body, parentId }),
  }).then((res) => jsonOrThrow<Comment>(res));
}

export function updateComment(id: number, body: string): Promise<Comment> {
  return fetch(`/api/comments/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body }),
  }).then((res) => jsonOrThrow<Comment>(res));
}

/** Mark a comment handled, or reopen it (024). */
export function resolveComment(id: number, resolved: boolean): Promise<Comment> {
  return fetch(`/api/comments/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ resolved }),
  }).then((res) => jsonOrThrow<Comment>(res));
}

export async function deleteComment(id: number): Promise<void> {
  const res = await fetch(`/api/comments/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Delete failed (${res.status})`);
}
