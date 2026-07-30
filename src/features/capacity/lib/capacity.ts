import type { CapacityRow, TimeOff } from "../types";

/**
 * The one work week the plan measures availability over: five workdays,
 * Monday–Friday. Weekends are not capacity, so an absence that falls on one
 * deducts nothing (090) — booking the weekend off must not shrink a budget.
 */
export const WORKWEEK_DAYS = 5;

/** ISO date (YYYY-MM-DD) `days` after the given one. UTC throughout, so the
 *  arithmetic cannot land a day early or late for a viewer's timezone. */
export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * The Monday–Sunday window containing `todayIso`. Capacity is a *weekly* budget
 * (041), so availability only means anything against a specific week; the plan
 * reports which one rather than implying the number holds forever.
 */
export function weekWindow(todayIso: string): { start: string; end: string } {
  const dow = new Date(`${todayIso}T00:00:00Z`).getUTCDay(); // 0 Sun … 6 Sat
  const start = addDays(todayIso, -((dow + 6) % 7)); // back to Monday
  return { start, end: addDays(start, 6) };
}

/** Saturday or Sunday. */
function isWeekend(iso: string): boolean {
  const dow = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return dow === 0 || dow === 6;
}

/**
 * How many whole workdays inside [windowStart, windowEnd] the entries take away.
 *
 * Counts *distinct* dates: overlapping entries (a sick day booked inside a
 * holiday, or the same leave synced twice) must not deduct the same day twice —
 * which is why 090 permits overlaps rather than refusing the second row.
 */
export function workdaysOff(
  entries: Pick<TimeOff, "startsOn" | "endsOn">[],
  windowStart: string,
  windowEnd: string
): number {
  const days = new Set<string>();
  for (const entry of entries) {
    const from = entry.startsOn > windowStart ? entry.startsOn : windowStart;
    const to = entry.endsOn < windowEnd ? entry.endsOn : windowEnd;
    for (let day = from; day <= to; day = addDays(day, 1)) {
      if (!isWeekend(day)) days.add(day);
    }
  }
  return days.size;
}

/**
 * A member's real budget for the week: their nominal weekly points prorated by
 * the workdays they are present. Whole days only — the plan's unit is a weekly
 * point budget, and no fraction of a day can change a whole-point answer.
 *
 * A member with no budget set stays 0: proration of an unknown is still unknown,
 * and the row reports that as a null utilization rather than inventing one.
 */
export function availablePoints(weeklyPoints: number, daysOff: number): number {
  if (weeklyPoints <= 0) return 0;
  const present = Math.max(0, WORKWEEK_DAYS - Math.min(daysOff, WORKWEEK_DAYS));
  return Math.round((weeklyPoints * present) / WORKWEEK_DAYS);
}

/**
 * A member's utilization: committed demand as a fraction of the capacity they
 * actually have this week, or null when that fraction says nothing — either no
 * budget is set (041's original case) or time off has consumed the whole week
 * (090). Both are "no ratio", and they are told apart in the UI by weeklyPoints.
 *
 * Over-allocation is deliberately NOT read off this number: someone away all
 * week while holding work is unambiguously over, even though the ratio is
 * undefined. See `isOverAllocated`.
 *
 * Split out so the board read and its test agree on the one formula, and so it
 * can change without a migration (it is derived, never stored).
 */
export function utilization(
  committedPoints: number,
  availableForWeek: number
): number | null {
  if (availableForWeek <= 0) return null;
  return committedPoints / availableForWeek;
}

/**
 * Over-allocated: demand exceeds the capacity actually available. A member with
 * no budget set is never over — you cannot over-fill a budget you never set —
 * but a member with a budget who is away all week and still holds work is,
 * which is exactly the state a nominal-only plan (041) could not report.
 */
export function isOverAllocated(row: CapacityRow): boolean {
  return row.weeklyPoints > 0 && row.committedPoints > row.availablePoints;
}

/** The plan's rollup — nominal capacity, capacity after time off, and total
 *  committed demand across the members. Pure arithmetic, the portfolio rollup's
 *  shape. `capacity` and `available` differ by exactly the week's absences. */
export function summarizeCapacity(rows: CapacityRow[]): {
  capacity: number;
  available: number;
  committed: number;
} {
  return rows.reduce(
    (acc, r) => ({
      capacity: acc.capacity + r.weeklyPoints,
      available: acc.available + r.availablePoints,
      committed: acc.committed + r.committedPoints,
    }),
    { capacity: 0, available: 0, committed: 0 }
  );
}
