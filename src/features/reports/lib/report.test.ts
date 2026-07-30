import { describe, expect, it } from "vitest";

import type { ReportFact, ReportSpec } from "../types";
import {
  forecastSpend,
  formatMetricValue,
  GROUP_BYS_BY_SOURCE,
  groupBysFor,
  isGroupByCompatible,
  isMetricCompatible,
  METRICS_BY_SOURCE,
  runReport,
} from "./report";

function fact(group: string, m: Partial<ReportFact> = {}): ReportFact {
  return {
    group,
    estimate: 0,
    minutes: 0,
    spend: 0,
    cycleDays: null,
    donePoints: 0,
    openPoints: 0,
    ...m,
  };
}

const spec = (o: Partial<ReportSpec>): ReportSpec => ({
  source: "tasks",
  groupBy: "none",
  metric: "count",
  ...o,
});

describe("runReport — count", () => {
  it("counts facts into a single Total when group_by is none", () => {
    const r = runReport(spec({ metric: "count", groupBy: "none" }), [
      fact("a"),
      fact("b"),
      fact("a"),
    ]);
    expect(r.total).toBe(3);
    expect(r.points).toEqual([{ label: "Total", value: 3 }]);
  });

  it("returns no points (but a zero total) for an empty fact set", () => {
    const r = runReport(spec({ metric: "count", groupBy: "none" }), []);
    expect(r.total).toBe(0);
    expect(r.points).toEqual([]);
  });

  it("buckets by group and orders by descending count", () => {
    const r = runReport(spec({ metric: "count", groupBy: "status" }), [
      fact("Todo"),
      fact("Done"),
      fact("Done"),
      fact("Done"),
      fact("Todo"),
    ]);
    expect(r.points).toEqual([
      { label: "Done", value: 3 },
      { label: "Todo", value: 2 },
    ]);
    expect(r.total).toBe(5);
  });
});

describe("runReport — sums", () => {
  it("sum:estimate adds the estimate measure per bucket", () => {
    const r = runReport(spec({ source: "tasks", metric: "sum:estimate", groupBy: "priority" }), [
      fact("high", { estimate: 3 }),
      fact("high", { estimate: 5 }),
      fact("low", { estimate: 2 }),
    ]);
    expect(r.points).toEqual([
      { label: "high", value: 8 },
      { label: "low", value: 2 },
    ]);
    expect(r.total).toBe(10);
  });

  it("sum:minutes rounds to whole minutes", () => {
    const r = runReport(spec({ source: "time", metric: "sum:minutes", groupBy: "user" }), [
      fact("Ada", { minutes: 30 }),
      fact("Ada", { minutes: 45 }),
    ]);
    expect(r.total).toBe(75);
  });

  it("sum:spend rounds to cents", () => {
    const r = runReport(spec({ source: "financial", metric: "sum:spend", groupBy: "board" }), [
      fact("Web", { spend: 10.005 }),
      fact("Web", { spend: 0.001 }),
    ]);
    // 10.006 → 10.01 at cent precision
    expect(r.points[0]).toEqual({ label: "Web", value: 10.01 });
  });
});

describe("runReport — avg:cycle", () => {
  it("averages non-null cycle days and ignores nulls", () => {
    const r = runReport(spec({ source: "flow", metric: "avg:cycle", groupBy: "board" }), [
      fact("Web", { cycleDays: 2 }),
      fact("Web", { cycleDays: 4 }),
      fact("Web", { cycleDays: null }),
    ]);
    expect(r.points).toEqual([{ label: "Web", value: 3 }]);
  });

  it("is zero when a bucket has no cycle data", () => {
    const r = runReport(spec({ source: "flow", metric: "avg:cycle", groupBy: "none" }), [
      fact("", { cycleDays: null }),
    ]);
    expect(r.total).toBe(0);
  });
});

describe("runReport — ordering", () => {
  it("orders day buckets chronologically, not by value", () => {
    const r = runReport(spec({ source: "time", metric: "sum:minutes", groupBy: "day" }), [
      fact("2026-07-03", { minutes: 10 }),
      fact("2026-07-01", { minutes: 90 }),
      fact("2026-07-02", { minutes: 20 }),
    ]);
    expect(r.points.map((p) => p.label)).toEqual([
      "2026-07-01",
      "2026-07-02",
      "2026-07-03",
    ]);
  });

  it("renders an empty group label as an em dash", () => {
    const r = runReport(spec({ metric: "count", groupBy: "assignee" }), [fact("")]);
    expect(r.points[0].label).toBe("—");
  });
});

describe("forecast:spend", () => {
  it("projects the observed rate per delivered point across the open work", () => {
    // 300 spent to deliver 10 points (30/pt), 5 points left ⇒ 300 + 150.
    expect(forecastSpend(300, 10, 5)).toBe(450);
  });

  it("is the spend to date when there is nothing left to project", () => {
    expect(forecastSpend(300, 10, 0)).toBe(300);
  });

  it("declines to project before anything is delivered", () => {
    // No rate can be observed yet — reporting the spend beats inventing a number.
    expect(forecastSpend(300, 0, 20)).toBe(300);
    expect(forecastSpend(0, 0, 20)).toBe(0);
  });

  it("folds a bucket as a ratio of sums, not a sum of ratios", () => {
    // Two time entries and two tasks in one bucket: 100 + 200 spent, 6 points
    // delivered, 3 open ⇒ 300 + (50 × 3).
    const r = runReport(spec({ source: "financial", metric: "forecast:spend" }), [
      fact("", { spend: 100 }),
      fact("", { spend: 200 }),
      fact("", { donePoints: 6 }),
      fact("", { openPoints: 3 }),
    ]);
    expect(r.total).toBe(450);
  });

  it("forecasts each board on its own rate when grouped", () => {
    const r = runReport(
      spec({ source: "financial", metric: "forecast:spend", groupBy: "board" }),
      [
        fact("Fast", { spend: 100 }),
        fact("Fast", { donePoints: 10 }),
        fact("Fast", { openPoints: 10 }),
        fact("Slow", { spend: 100 }),
        fact("Slow", { donePoints: 2 }),
        fact("Slow", { openPoints: 10 }),
      ]
    );
    expect(r.points).toEqual([
      { label: "Slow", value: 600 },
      { label: "Fast", value: 200 },
    ]);
  });

  it("formats as money like the spend it projects", () => {
    expect(formatMetricValue("forecast:spend", 450, "USD")).toBe("450.00 USD");
  });
});

describe("compatibility guards", () => {
  it("pairs each source with only its metrics", () => {
    expect(isMetricCompatible("tasks", "count")).toBe(true);
    expect(isMetricCompatible("tasks", "sum:minutes")).toBe(false);
    expect(isMetricCompatible("time", "sum:minutes")).toBe(true);
    expect(isMetricCompatible("flow", "avg:cycle")).toBe(true);
    expect(isMetricCompatible("financial", "sum:spend")).toBe(true);
    expect(isMetricCompatible("financial", "forecast:spend")).toBe(true);
    expect(isMetricCompatible("time", "forecast:spend")).toBe(false);
  });

  it("pairs each source with only its groupings", () => {
    expect(isGroupByCompatible("tasks", "status")).toBe(true);
    expect(isGroupByCompatible("time", "status")).toBe(false);
    expect(isGroupByCompatible("flow", "user")).toBe(false);
    expect(isGroupByCompatible("flow", "board")).toBe(true);
  });

  it("lets the forecast narrow its source's groupings", () => {
    // financial alone allows user/day; the forecast cannot label a task with one.
    expect(isGroupByCompatible("financial", "user")).toBe(true);
    expect(isGroupByCompatible("financial", "user", "forecast:spend")).toBe(false);
    expect(isGroupByCompatible("financial", "board", "forecast:spend")).toBe(true);
    expect(groupBysFor("financial", "forecast:spend")).toEqual(["none", "board"]);
    // A metric with no restriction of its own leaves the source's list alone.
    expect(groupBysFor("financial", "sum:spend")).toEqual(
      GROUP_BYS_BY_SOURCE.financial
    );
  });

  it("keeps the two maps covering every source", () => {
    for (const source of ["tasks", "time", "flow", "financial"] as const) {
      expect(METRICS_BY_SOURCE[source].length).toBeGreaterThan(0);
      expect(GROUP_BYS_BY_SOURCE[source]).toContain("none");
    }
  });
});
