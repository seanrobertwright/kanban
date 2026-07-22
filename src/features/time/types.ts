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

/**
 * A board timesheet: the time_entry ledger rolled up per contributor per
 * day over a window, so an admin can review who logged what across a week rather
 * than opening tasks one at a time. Time tracking is humans-only (027), so a row
 * is always a person — an agent's spend stays metered in dollars, not minutes.
 */
export interface TimesheetRow {
  userId: string;
  userName: string | null;
  /** 'YYYY-MM-DD' → minutes that day; only days with entries are present. */
  byDay: Record<string, number>;
  total: number;
}

export interface Timesheet {
  /** The (inclusive) window, 'YYYY-MM-DD' — clamped server-side to a bound. */
  from: string;
  to: string;
  /** Every date in [from, to], so the grid can render empty days too. */
  days: string[];
  rows: TimesheetRow[];
  /** 'YYYY-MM-DD' → minutes across all contributors that day (column footer). */
  dayTotals: Record<string, number>;
  total: number;
}

/** One ungrouped ledger fact, as the board rollup query returns it. */
export interface TimesheetCell {
  userId: string;
  userName: string | null;
  spentOn: string;
  minutes: number;
}
