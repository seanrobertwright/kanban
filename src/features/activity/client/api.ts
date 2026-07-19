import type { ActivityEntry, WorkspaceNotifications } from "../types";

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

export async function fetchNotifications(
  workspaceId: string
): Promise<WorkspaceNotifications> {
  const res = await fetch(`/api/workspaces/${workspaceId}/notifications`, {
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `Request failed (${res.status})`);
  }
  return res.json();
}

/** Marks everything read; returns the new last-seen timestamp. */
export async function markNotificationsSeen(
  workspaceId: string
): Promise<string> {
  const res = await fetch(`/api/workspaces/${workspaceId}/notifications/seen`, {
    method: "POST",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `Request failed (${res.status})`);
  }
  return (await res.json()).lastSeenAt as string;
}
