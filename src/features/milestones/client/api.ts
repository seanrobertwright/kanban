import type { Milestone } from "../types";

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

export async function fetchMilestones(boardId: number): Promise<Milestone[]> {
  const res = await fetch(`/api/board/${boardId}/milestones`, {
    cache: "no-store",
  });
  return jsonOrThrow<Milestone[]>(res);
}

export function createMilestone(
  boardId: number,
  name: string,
  dueDate: string | null,
  epicId: number | null = null,
  objectiveId: number | null = null
): Promise<Milestone> {
  return fetch(`/api/board/${boardId}/milestones`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, dueDate, epicId, objectiveId }),
  }).then((res) => jsonOrThrow<Milestone>(res));
}

/**
 * A partial update. Omitting `epicId` or `objectiveId` leaves that filing
 * alone; passing `null` clears it — the server distinguishes the two with
 * `"epicId" in payload`, so the difference is real and worth preserving here.
 */
export function updateMilestone(
  id: number,
  input: {
    name?: string;
    dueDate?: string | null;
    epicId?: number | null;
    objectiveId?: number | null;
  }
): Promise<Milestone> {
  return fetch(`/api/milestones/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((res) => jsonOrThrow<Milestone>(res));
}

export async function deleteMilestone(id: number): Promise<void> {
  const res = await fetch(`/api/milestones/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Delete failed (${res.status})`);
}
