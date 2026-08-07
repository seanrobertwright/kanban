import type {
  TaskTime,
  TimeEntry,
  TimesheetApproval,
  TimesheetWithApprovals,
} from "../types";

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

/**
 * `spentOn` is the caller's *local* date (UI-3). Omitting it falls back to the
 * server's `CURRENT_DATE`, which is the database's zone — UTC here — and dates
 * an evening's work to tomorrow for every reader behind Greenwich. It stays
 * optional because the fallback is right for a caller with no reader to ask,
 * and wrong only when there is one.
 */
export function addTimeEntry(
  taskId: number,
  minutes: number,
  note: string,
  spentOn?: string | null
): Promise<TimeEntry> {
  return fetch(`/api/tasks/${taskId}/time`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(spentOn ? { minutes, note, spentOn } : { minutes, note }),
  }).then((res) => jsonOrThrow<TimeEntry>(res));
}

/** The board's per-contributor, per-day time rollup over an optional
 *  window; the server defaults and clamps it, so bare params are fine. */
export async function fetchBoardTimesheet(
  boardId: number,
  window: { from?: string; to?: string } = {}
): Promise<TimesheetWithApprovals> {
  const qs = new URLSearchParams();
  if (window.from) qs.set("from", window.from);
  if (window.to) qs.set("to", window.to);
  const suffix = qs.toString() ? `?${qs}` : "";
  const res = await fetch(`/api/board/${boardId}/timesheet${suffix}`, {
    cache: "no-store",
  });
  return jsonOrThrow<TimesheetWithApprovals>(res);
}

/**
 * Submit your own week, or record a verdict on someone's (083). `week` is any
 * day in the week; the server files it under that week's Monday. `userId` is
 * required for a verdict and meaningless for a submission — you may only ever
 * submit your own.
 */
export function reviewTimesheet(
  boardId: number,
  body: {
    week: string;
    verdict: "submitted" | "approved" | "rejected";
    userId?: string;
    note?: string;
  }
): Promise<TimesheetApproval> {
  return fetch(`/api/board/${boardId}/timesheet/approvals`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((res) => jsonOrThrow<TimesheetApproval>(res));
}

export async function deleteTimeEntry(id: number): Promise<void> {
  const res = await fetch(`/api/time/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Delete failed (${res.status})`);
}
