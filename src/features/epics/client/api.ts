import type { Epic } from "../types";

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

export async function fetchEpics(boardId: number): Promise<Epic[]> {
  const res = await fetch(`/api/board/${boardId}/epics`, {
    cache: "no-store",
  });
  return jsonOrThrow<Epic[]>(res);
}

export function createEpic(boardId: number, name: string): Promise<Epic> {
  return fetch(`/api/board/${boardId}/epics`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  }).then((res) => jsonOrThrow<Epic>(res));
}

export async function deleteEpic(id: number): Promise<void> {
  const res = await fetch(`/api/epics/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Delete failed (${res.status})`);
}
