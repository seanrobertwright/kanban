import type { Release, ReleaseState } from "../types";

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(
      (body as { error?: string } | null)?.error ?? `Request failed (${res.status})`
    );
  }
  return res.json() as Promise<T>;
}

export async function fetchReleases(boardId: number): Promise<Release[]> {
  const res = await fetch(`/api/board/${boardId}/releases`, { cache: "no-store" });
  return jsonOrThrow<Release[]>(res);
}

export function createRelease(
  boardId: number,
  name: string,
  notes: string | null = null
): Promise<Release> {
  return fetch(`/api/board/${boardId}/releases`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, notes }),
  }).then((res) => jsonOrThrow<Release>(res));
}

export function updateRelease(
  id: number,
  patch: { name?: string; notes?: string | null; state?: ReleaseState }
): Promise<Release> {
  return fetch(`/api/releases/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  }).then((res) => jsonOrThrow<Release>(res));
}

export async function deleteRelease(id: number): Promise<void> {
  const res = await fetch(`/api/releases/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Delete failed (${res.status})`);
}

export async function fetchReleaseTasks(
  id: number
): Promise<{ id: number; title: string }[]> {
  const res = await fetch(`/api/releases/${id}/tasks`, { cache: "no-store" });
  return jsonOrThrow<{ id: number; title: string }[]>(res);
}

export async function setTaskRelease(
  releaseId: number,
  taskId: number,
  assign: boolean
): Promise<void> {
  const res = await fetch(`/api/releases/${releaseId}/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ taskId, assign }),
  });
  if (!res.ok && res.status !== 204) throw new Error(`Request failed (${res.status})`);
}
