import { describe, expect, it } from "vitest";

import type { ReportFact, ReportSpec } from "../types";
import {
  GROUP_BYS_BY_SOURCE,
  isGroupByCompatible,
  isMetricCompatible,
  METRICS_BY_SOURCE,
  runReport,
} from "./report";

function fact(group: string, m: Partial<ReportFact> = {}): ReportFact {
  return { group, estimate: 0, minutes: 0, spend: 0, cycleDays: null, ...m };
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

describe("compatibility guards", () => {
  it("pairs each source with only its metrics", () => {
    expect(isMetricCompatible("tasks", "count")).toBe(true);
    expect(isMetricCompatible("tasks", "sum:minutes")).toBe(false);
    expect(isMetricCompatible("time", "sum:minutes")).toBe(true);
    expect(isMetricCompatible("flow", "avg:cycle")).toBe(true);
    expect(isMetricCompatible("financial", "sum:spend")).toBe(true);
  });

  it("pairs each source with only its groupings", () => {
    expect(isGroupByCompatible("tasks", "status")).toBe(true);
    expect(isGroupByCompatible("time", "status")).toBe(false);
    expect(isGroupByCompatible("flow", "user")).toBe(false);
    expect(isGroupByCompatible("flow", "board")).toBe(true);
  });

  it("keeps the two maps covering every source", () => {
    for (const source of ["tasks", "time", "flow", "financial"] as const) {
      expect(METRICS_BY_SOURCE[source].length).toBeGreaterThan(0);
      expect(GROUP_BYS_BY_SOURCE[source]).toContain("none");
    }
  });
});
