import { describe, expect, it } from "vitest";

import type { CapacityRow } from "../types";
import { isOverAllocated, summarizeCapacity, utilization } from "./capacity";

/** The utilization maths and rollup are pure (041), tested without a database. */

function row(committed: number, capacity: number): CapacityRow {
  return {
    userId: "u",
    name: "U",
    role: "",
    weeklyPoints: capacity,
    committedPoints: committed,
    openTasks: 0,
    utilization: utilization(committed, capacity),
  };
}

describe("utilization", () => {
  it("is demand over capacity", () => {
    expect(utilization(5, 10)).toBe(0.5);
    expect(utilization(10, 10)).toBe(1);
    expect(utilization(15, 10)).toBe(1.5);
  });

  it("is null when no capacity is set", () => {
    expect(utilization(5, 0)).toBeNull();
    expect(utilization(0, 0)).toBeNull();
  });
});

describe("isOverAllocated", () => {
  it("flags demand past capacity, never an unset budget", () => {
    expect(isOverAllocated(row(15, 10))).toBe(true);
    expect(isOverAllocated(row(10, 10))).toBe(false);
    expect(isOverAllocated(row(5, 0))).toBe(false); // null utilization
  });
});

describe("summarizeCapacity", () => {
  it("sums capacity and committed across rows", () => {
    expect(summarizeCapacity([row(5, 10), row(8, 6)])).toEqual({
      capacity: 16,
      committed: 13,
    });
  });
});
