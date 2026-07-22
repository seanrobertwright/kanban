import type { TaskTime, TimeEntry, Timesheet } from "../types";

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

/** The board's per-contributor, per-day time rollup over an optional
 *  window; the server defaults and clamps it, so bare params are fine. */
export async function fetchBoardTimesheet(
  boardId: number,
  window: { from?: string; to?: string } = {}
): Promise<Timesheet> {
  const qs = new URLSearchParams();
  if (window.from) qs.set("from", window.from);
  if (window.to) qs.set("to", window.to);
  const suffix = qs.toString() ? `?${qs}` : "";
  const res = await fetch(`/api/board/${boardId}/timesheet${suffix}`, {
    cache: "no-store",
  });
  return jsonOrThrow<Timesheet>(res);
}

export async function deleteTimeEntry(id: number): Promise<void> {
  const res = await fetch(`/api/time/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Delete failed (${res.status})`);
}
