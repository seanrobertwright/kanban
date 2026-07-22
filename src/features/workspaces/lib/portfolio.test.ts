import { describe, expect, it } from "vitest";

import type { PortfolioBoard } from "../types";
import { donePercent, summarizePortfolio } from "./portfolio";

/** Pure portfolio rollup (040) — no database. */

function board(over: Partial<PortfolioBoard> = {}): PortfolioBoard {
  return {
    id: 1,
    name: "Board",
    total: 0,
    done: 0,
    hasDoneColumn: true,
    milestones: 0,
    overdue: 0,
    ...over,
  };
}

describe("summarizePortfolio", () => {
  it("sums each board's counts into the workspace totals", () => {
    const { totals } = summarizePortfolio([
      board({ total: 10, done: 4, overdue: 1 }),
      board({ total: 6, done: 6, overdue: 0 }),
    ]);
    expect(totals).toEqual({ boards: 2, total: 16, done: 10, overdue: 1 });
  });

  it("is all zeros for an empty workspace", () => {
    const { totals } = summarizePortfolio([]);
    expect(totals).toEqual({ boards: 0, total: 0, done: 0, overdue: 0 });
  });

  it("passes the boards through untouched", () => {
    const boards = [board({ id: 7, name: "Ops" })];
    expect(summarizePortfolio(boards).boards).toBe(boards);
  });
});

describe("donePercent", () => {
  it("rounds to a whole percent", () => {
    expect(donePercent(1, 3)).toBe(33);
    expect(donePercent(2, 3)).toBe(67);
  });
  it("is 0, not NaN, when there is nothing to do", () => {
    expect(donePercent(0, 0)).toBe(0);
  });
  it("is 100 when everything is done", () => {
    expect(donePercent(5, 5)).toBe(100);
  });
});
