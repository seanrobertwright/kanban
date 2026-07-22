import type { PortfolioBoard, Portfolio } from "../types";

/**
 * The portfolio's cross-board totals (040), split from the DB read so the
 * rollup is unit-testable. Pure arithmetic — the workspace's numbers are the
 * sum of its boards', which is exactly what "portfolio rollup" names.
 */
export function summarizePortfolio(boards: PortfolioBoard[]): Portfolio {
  const totals = boards.reduce(
    (acc, b) => ({
      boards: acc.boards + 1,
      total: acc.total + b.total,
      done: acc.done + b.done,
      overdue: acc.overdue + b.overdue,
    }),
    { boards: 0, total: 0, done: 0, overdue: 0 }
  );
  return { boards, totals };
}

/** Done as a whole-percent of total, 0 when a board (or the workspace) holds no
 *  tasks — the milestone bar's guard, so a fresh board reads 0% not NaN%. */
export function donePercent(done: number, total: number): number {
  return total === 0 ? 0 : Math.round((done / total) * 100);
}
