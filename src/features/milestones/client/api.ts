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

export async function deleteMilestone(id: number): Promise<void> {
  const res = await fetch(`/api/milestones/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Delete failed (${res.status})`);
}
