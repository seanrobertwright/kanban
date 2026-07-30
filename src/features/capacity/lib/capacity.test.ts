import { describe, expect, it } from "vitest";

import type { CapacityRow } from "../types";
import {
  addDays,
  availablePoints,
  isOverAllocated,
  summarizeCapacity,
  utilization,
  weekWindow,
  workdaysOff,
} from "./capacity";

/** The utilization maths, the time-off proration and the rollup are pure
 *  (041 + 090), tested without a database. */

function row(committed: number, capacity: number, daysOff = 0): CapacityRow {
  const available = availablePoints(capacity, daysOff);
  return {
    userId: "u",
    name: "U",
    role: "",
    weeklyPoints: capacity,
    daysOff,
    availablePoints: available,
    committedPoints: committed,
    openTasks: 0,
    utilization: utilization(committed, available),
    timeOff: [],
  };
}

describe("utilization", () => {
  it("is demand over the capacity actually available", () => {
    expect(utilization(5, 10)).toBe(0.5);
    expect(utilization(10, 10)).toBe(1);
    expect(utilization(15, 10)).toBe(1.5);
  });

  it("is null when there is no capacity to divide by", () => {
    expect(utilization(5, 0)).toBeNull();
    expect(utilization(0, 0)).toBeNull();
  });
});

describe("weekWindow", () => {
  it("runs Monday to Sunday around the given day", () => {
    // 2026-07-30 is a Thursday.
    expect(weekWindow("2026-07-30")).toEqual({
      start: "2026-07-27",
      end: "2026-08-02",
    });
    // A Monday is its own week start; a Sunday belongs to the week behind it.
    expect(weekWindow("2026-07-27").start).toBe("2026-07-27");
    expect(weekWindow("2026-08-02").start).toBe("2026-07-27");
  });

  it("crosses a month and a year boundary", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(weekWindow("2027-01-01")).toEqual({
      start: "2026-12-28",
      end: "2027-01-03",
    });
  });
});

describe("workdaysOff", () => {
  const week = weekWindow("2026-07-30"); // Mon 27 Jul – Sun 2 Aug

  it("counts whole workdays inside the window", () => {
    expect(
      workdaysOff([{ startsOn: "2026-07-28", endsOn: "2026-07-29" }], week.start, week.end)
    ).toBe(2);
  });

  it("ignores weekend days", () => {
    // Sat 1 Aug – Sun 2 Aug: booked off, but no capacity was there to lose.
    expect(
      workdaysOff([{ startsOn: "2026-08-01", endsOn: "2026-08-02" }], week.start, week.end)
    ).toBe(0);
  });

  it("clamps a range that overhangs the window", () => {
    // Whole of July into mid-August, but only Mon–Fri of this week counts.
    expect(
      workdaysOff([{ startsOn: "2026-07-01", endsOn: "2026-08-14" }], week.start, week.end)
    ).toBe(5);
  });

  it("never deducts an overlapping day twice", () => {
    expect(
      workdaysOff(
        [
          { startsOn: "2026-07-27", endsOn: "2026-07-31" },
          { startsOn: "2026-07-29", endsOn: "2026-07-29" },
        ],
        week.start,
        week.end
      )
    ).toBe(5);
  });

  it("counts nothing for leave entirely outside the window", () => {
    expect(
      workdaysOff([{ startsOn: "2026-09-01", endsOn: "2026-09-04" }], week.start, week.end)
    ).toBe(0);
  });
});

describe("availablePoints", () => {
  it("prorates the weekly budget by the workdays present", () => {
    expect(availablePoints(10, 0)).toBe(10);
    expect(availablePoints(10, 1)).toBe(8);
    expect(availablePoints(10, 5)).toBe(0);
  });

  it("rounds to whole points and never goes negative", () => {
    expect(availablePoints(8, 1)).toBe(6); // 6.4 → 6
    expect(availablePoints(8, 3)).toBe(3); // 3.2 → 3
    expect(availablePoints(10, 9)).toBe(0); // more days off than a work week has
  });

  it("leaves an unset budget unset", () => {
    expect(availablePoints(0, 2)).toBe(0);
  });
});

describe("isOverAllocated", () => {
  it("flags demand past capacity, never an unset budget", () => {
    expect(isOverAllocated(row(15, 10))).toBe(true);
    expect(isOverAllocated(row(10, 10))).toBe(false);
    expect(isOverAllocated(row(5, 0))).toBe(false); // no budget set
  });

  it("flags a member whose time off left them no room", () => {
    // 10 pts/week, away 3 workdays → 4 available, 5 committed.
    expect(isOverAllocated(row(5, 10, 3))).toBe(true);
    // Away the whole week with work still on them: no ratio, still over.
    const awayAllWeek = row(5, 10, 5);
    expect(awayAllWeek.utilization).toBeNull();
    expect(isOverAllocated(awayAllWeek)).toBe(true);
    // Away the whole week with nothing on them is not over.
    expect(isOverAllocated(row(0, 10, 5))).toBe(false);
  });
});

describe("summarizeCapacity", () => {
  it("sums nominal capacity, available capacity and committed across rows", () => {
    expect(summarizeCapacity([row(5, 10), row(8, 6, 5)])).toEqual({
      capacity: 16,
      available: 10,
      committed: 13,
    });
  });
});
