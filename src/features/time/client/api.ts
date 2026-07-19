import type { TaskTime, TimeEntry } from "../types";

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

export async function fetchTaskTime(taskId: number): Promise<TaskTime> {
  const res = await fetch(`/api/tasks/${taskId}/time`, { cache: "no-store" });
  return jsonOrThrow<TaskTime>(res);
}

export function addTimeEntry(
  taskId: number,
  minutes: number,
  note: string
): Promise<TimeEntry> {
  return fetch(`/api/tasks/${taskId}/time`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ minutes, note }),
  }).then((res) => jsonOrThrow<TimeEntry>(res));
}

export async function deleteTimeEntry(id: number): Promise<void> {
  const res = await fetch(`/api/time/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Delete failed (${res.status})`);
}
