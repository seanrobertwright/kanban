/**
 * A time-tracking entry (027) — minutes spent on a task, an append-only
 * ledger rather than a timer. Humans only: an agent's spend is metered in
 * dollars by the run's cost telemetry, not in minutes here.
 */
export interface TimeEntry {
  id: number;
  taskId: number;
  userId: string;
  minutes: number;
  /** 'YYYY-MM-DD' — the day the work happened, not the instant it was logged. */
  spentOn: string;
  note: string;
  createdAt: string;
}

/** An entry joined to its author for rendering — CommentEntry's shape. */
export interface TimeEntryRow extends TimeEntry {
  userName: string | null;
  /** Own entry, or admin — the comment-delete rule. */
  canDelete: boolean;
}

export interface TaskTime {
  entries: TimeEntryRow[];
  totalMinutes: number;
}

/** Render minutes as "3h 20m" / "45m" — one home, so every surface agrees. */
export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
