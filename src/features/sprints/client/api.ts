import type { Sprint, SprintCapacityRow } from "../types";

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

export interface SprintBoard {
  sprints: Sprint[];
  capacity: SprintCapacityRow[];
}

export async function fetchSprints(boardId: number): Promise<SprintBoard> {
  const res = await fetch(`/api/board/${boardId}/sprints`, {
    cache: "no-store",
  });
  return jsonOrThrow<SprintBoard>(res);
}

export function createSprint(
  boardId: number,
  name: string,
  goal: string,
  startDate: string | null,
  endDate: string | null
): Promise<Sprint> {
  return fetch(`/api/board/${boardId}/sprints`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, goal, startDate, endDate }),
  }).then((res) => jsonOrThrow<Sprint>(res));
}

export function startSprint(id: number): Promise<Sprint> {
  return fetch(`/api/sprints/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "start" }),
  }).then((res) => jsonOrThrow<Sprint>(res));
}

export function completeSprint(
  id: number,
  rolloverToSprintId: number | null
): Promise<Sprint> {
  return fetch(`/api/sprints/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "complete", rolloverToSprintId }),
  }).then((res) => jsonOrThrow<Sprint>(res));
}

export async function deleteSprint(id: number): Promise<void> {
  const res = await fetch(`/api/sprints/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Delete failed (${res.status})`);
}
