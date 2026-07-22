import { describe, expect, it } from "vitest";

import { budgetUtilization, costOf, remainingOf, toCents } from "./budget";

/** The money maths are pure (042), tested without a database. */

describe("costOf", () => {
  it("costs logged minutes at an hourly rate, rounded to cents", () => {
    expect(costOf(60, 100)).toBe(100); // 1h @ 100
    expect(costOf(90, 100)).toBe(150); // 1.5h @ 100
    expect(costOf(10, 100)).toBeCloseTo(16.67, 2); // 10min @ 100 = 16.666…
    expect(costOf(0, 100)).toBe(0);
  });
});

describe("remainingOf", () => {
  it("is budget minus spend, null when no budget", () => {
    expect(remainingOf(1000, 250)).toBe(750);
    expect(remainingOf(1000, 1200)).toBe(-200); // over budget
    expect(remainingOf(null, 250)).toBeNull();
  });
});

describe("budgetUtilization", () => {
  it("is spend over budget, null when no budget or zero budget", () => {
    expect(budgetUtilization(1000, 250)).toBe(0.25);
    expect(budgetUtilization(null, 250)).toBeNull();
    expect(budgetUtilization(0, 250)).toBeNull();
  });
});

describe("toCents", () => {
  it("rounds to two places", () => {
    expect(toCents(16.666)).toBe(16.67);
    expect(toCents(10)).toBe(10);
  });
});
