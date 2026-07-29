import type { Epic, EpicStatus } from "../types";

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

/**
 * The PATCH the route has answered since 031 and nothing has ever called — the
 * dead-door shape the code review names, in its other direction: a working
 * endpoint with no client function, so renaming an epic needed curl. Fields are
 * omitted rather than sent as undefined, since JSON.stringify drops undefined
 * and the handler reads absence as "leave it" — an explicit null on ownerId is
 * the only way to un-own an epic.
 */
export function updateEpic(
  id: number,
  input: { name?: string; status?: EpicStatus; ownerId?: string | null }
): Promise<Epic> {
  return fetch(`/api/epics/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((res) => jsonOrThrow<Epic>(res));
}

export async function deleteEpic(id: number): Promise<void> {
  const res = await fetch(`/api/epics/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Delete failed (${res.status})`);
}
