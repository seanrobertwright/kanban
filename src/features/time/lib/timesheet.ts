import type { Timesheet, TimesheetCell, TimesheetRow } from "../types";

/**
 * The pure shape of the timesheet grid, split from the DB read so the
 * grouping is unit-testable. Same date discipline as schedule.ts: the day list
 * is stepped through UTC on 'YYYY-MM-DD' strings, never a local-zone `new Date`.
 */

const pad = (n: number) => String(n).padStart(2, "0");

/** `iso` shifted by `n` whole days, still 'YYYY-MM-DD' (schedule.ts's addDays). */
export function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/** Every date from `from` to `to` inclusive; empty when to precedes from. */
export function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  let d = from;
  while (d <= to) {
    out.push(d);
    d = addDays(d, 1);
  }
  return out;
}

/**
 * Fold flat (user, day, minutes) cells into a per-contributor grid across the
 * [from, to] window. Rows are sorted by total desc, then name, then id — a
 * stable order so the busiest contributor leads and ties do not shuffle.
 */
export function buildTimesheetGrid(
  from: string,
  to: string,
  cells: TimesheetCell[]
): Timesheet {
  const days = eachDay(from, to);
  const rowById = new Map<string, TimesheetRow>();
  const dayTotals: Record<string, number> = {};
  let total = 0;

  for (const cell of cells) {
    // A cell outside the window is ignored — the query bounds it, but the grid
    // must not invent a column the header does not have.
    if (cell.spentOn < from || cell.spentOn > to) continue;

    let row = rowById.get(cell.userId);
    if (!row) {
      row = {
        userId: cell.userId,
        userName: cell.userName,
        byDay: {},
        total: 0,
      };
      rowById.set(cell.userId, row);
    }
    row.byDay[cell.spentOn] = (row.byDay[cell.spentOn] ?? 0) + cell.minutes;
    row.total += cell.minutes;
    dayTotals[cell.spentOn] = (dayTotals[cell.spentOn] ?? 0) + cell.minutes;
    total += cell.minutes;
  }

  const rows = [...rowById.values()].sort(
    (a, b) =>
      b.total - a.total ||
      (a.userName ?? "").localeCompare(b.userName ?? "") ||
      a.userId.localeCompare(b.userId)
  );

  return { from, to, days, rows, dayTotals, total };
}
