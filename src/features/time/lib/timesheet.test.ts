import { describe, expect, it } from "vitest";

import type { TimesheetCell } from "../types";
import {
  addDays,
  buildTimesheetGrid,
  eachDay,
  resolveWindow,
  weekStart,
} from "./timesheet";

/** Pure timesheet grouping — no database, same UTC date discipline. */

describe("eachDay", () => {
  it("lists an inclusive window", () => {
    expect(eachDay("2026-07-20", "2026-07-22")).toEqual([
      "2026-07-20",
      "2026-07-21",
      "2026-07-22",
    ]);
  });
  it("crosses a month boundary without drifting a day", () => {
    expect(eachDay("2026-07-30", "2026-08-01")).toEqual([
      "2026-07-30",
      "2026-07-31",
      "2026-08-01",
    ]);
  });
  it("is empty when the window inverts", () => {
    expect(eachDay("2026-07-22", "2026-07-20")).toEqual([]);
  });
  it("steps addDays across a year boundary", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("buildTimesheetGrid", () => {
  const cells: TimesheetCell[] = [
    { userId: "u1", userName: "Alice", spentOn: "2026-07-20", minutes: 60 },
    { userId: "u1", userName: "Alice", spentOn: "2026-07-20", minutes: 30 },
    { userId: "u1", userName: "Alice", spentOn: "2026-07-21", minutes: 45 },
    { userId: "u2", userName: "Bob", spentOn: "2026-07-21", minutes: 120 },
  ];

  it("sums a contributor's minutes per day and overall", () => {
    const { rows } = buildTimesheetGrid("2026-07-20", "2026-07-22", cells);
    const alice = rows.find((r) => r.userId === "u1")!;
    expect(alice.byDay["2026-07-20"]).toBe(90); // two entries merged
    expect(alice.byDay["2026-07-21"]).toBe(45);
    expect(alice.total).toBe(135);
  });

  it("orders rows by total desc, so the busiest leads", () => {
    const { rows } = buildTimesheetGrid("2026-07-20", "2026-07-22", cells);
    // Bob logged 120 in the window, Alice 135 — Alice leads.
    expect(rows.map((r) => r.userId)).toEqual(["u1", "u2"]);
  });

  it("totals each day across contributors and the whole grid", () => {
    const { dayTotals, total } = buildTimesheetGrid(
      "2026-07-20",
      "2026-07-22",
      cells
    );
    expect(dayTotals["2026-07-20"]).toBe(90);
    expect(dayTotals["2026-07-21"]).toBe(165); // Alice 45 + Bob 120
    expect(total).toBe(255);
  });

  it("renders every day in the window, entries or not", () => {
    const { days } = buildTimesheetGrid("2026-07-20", "2026-07-22", cells);
    expect(days).toEqual(["2026-07-20", "2026-07-21", "2026-07-22"]);
  });

  it("drops a cell that falls outside the window", () => {
    const { total, rows } = buildTimesheetGrid("2026-07-21", "2026-07-22", [
      { userId: "u1", userName: "Alice", spentOn: "2026-07-20", minutes: 90 },
    ]);
    expect(total).toBe(0);
    expect(rows).toHaveLength(0);
  });
});

describe("resolveWindow", () => {
  // 2026-07-20 is a Monday, so this covers every weekday in one week.
  const week = [
    "2026-07-20",
    "2026-07-21",
    "2026-07-22",
    "2026-07-23",
    "2026-07-24",
    "2026-07-25",
    "2026-07-26",
  ];

  it("defaults to the Mon-Sun week containing today, whatever day it is", () => {
    for (const today of week) {
      expect(resolveWindow(today, null, null, 31)).toEqual({
        from: "2026-07-20",
        to: "2026-07-26",
      });
    }
  });

  /**
   * The rule the default exists for: sign-off is filed under weekStart(from)
   * (083), so a window whose `from` is not already a Monday would record a
   * verdict against a week other than the one the grid showed.
   */
  it("starts the default window on the day sign-off is keyed to", () => {
    for (const today of week) {
      const { from } = resolveWindow(today, null, null, 31);
      expect(weekStart(from)).toBe(from);
    }
  });

  it("completes a seven-day span from whichever end is given", () => {
    expect(resolveWindow("2026-07-22", "2026-07-15", null, 31)).toEqual({
      from: "2026-07-15",
      to: "2026-07-21",
    });
    expect(resolveWindow("2026-07-22", null, "2026-07-21", 31)).toEqual({
      from: "2026-07-15",
      to: "2026-07-21",
    });
  });

  it("honours a window the caller fully specifies", () => {
    expect(resolveWindow("2026-07-22", "2026-07-01", "2026-07-10", 31)).toEqual({
      from: "2026-07-01",
      to: "2026-07-10",
    });
  });

  it("clamps an over-long span by trimming the older end", () => {
    expect(resolveWindow("2026-07-22", "2026-01-01", "2026-07-22", 31)).toEqual({
      from: "2026-06-22",
      to: "2026-07-22",
    });
  });

  it("collapses an inverted window rather than inventing days", () => {
    expect(resolveWindow("2026-07-22", "2026-07-20", "2026-07-10", 31)).toEqual({
      from: "2026-07-10",
      to: "2026-07-10",
    });
  });
});
