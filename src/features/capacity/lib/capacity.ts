import type { CapacityRow } from "../types";

/**
 * A member's utilization: committed demand as a fraction of their weekly point
 * budget, or null when no budget is set (0) — a demand against an unknown
 * capacity has no ratio, which is a different state from 0%. Split out so the
 * board read and its test agree on the one formula, and so it can change without
 * a migration (it is derived, never stored).
 */
export function utilization(
  committedPoints: number,
  weeklyPoints: number
): number | null {
  if (weeklyPoints <= 0) return null;
  return committedPoints / weeklyPoints;
}

/** Over-allocated: demand exceeds capacity. Null utilization (no budget) is not
 *  over — you cannot over-fill a budget you never set. */
export function isOverAllocated(row: CapacityRow): boolean {
  return row.utilization !== null && row.utilization > 1;
}

/** The plan's rollup — total capacity and total committed demand across the
 *  members. Pure arithmetic, the portfolio rollup's shape. */
export function summarizeCapacity(rows: CapacityRow[]): {
  capacity: number;
  committed: number;
} {
  return rows.reduce(
    (acc, r) => ({
      capacity: acc.capacity + r.weeklyPoints,
      committed: acc.committed + r.committedPoints,
    }),
    { capacity: 0, committed: 0 }
  );
}
