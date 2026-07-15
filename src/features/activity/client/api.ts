import type { ActivityEntry } from "../types";

export async function fetchTaskActivity(
  taskId: number
): Promise<ActivityEntry[]> {
  const res = await fetch(`/api/tasks/${taskId}/activity`, {
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `Request failed (${res.status})`);
  }
  return res.json();
}
