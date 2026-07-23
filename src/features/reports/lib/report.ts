/**
 * Pure report aggregation (rocks 5.1 + 5.2).
 *
 * `runReport` folds a flat list of `ReportFact`s — each already carrying its
 * bucket label and every candidate measure — into a `ReportResult`. All the
 * source-specific work (which rows, which bucket label, filling the right
 * measure) happens in the repository; here we only apply the metric and shape
 * the series. No I/O, fully deterministic, unit-tested.
 */
import { toCents } from "@/features/budget/lib/budget";

import type {
  ReportFact,
  ReportGroupBy,
  ReportMetric,
  ReportPoint,
  ReportResult,
  ReportSource,
  ReportSpec,
} from "../types";

/** Which metrics each source can produce. */
export const METRICS_BY_SOURCE: Record<ReportSource, ReportMetric[]> = {
  tasks: ["count", "sum:estimate"],
  time: ["sum:minutes"],
  flow: ["avg:cycle"],
  financial: ["sum:spend"],
};

/** Which groupings each source supports. */
export const GROUP_BYS_BY_SOURCE: Record<ReportSource, ReportGroupBy[]> = {
  tasks: ["none", "status", "assignee", "priority", "label", "board"],
  time: ["none", "user", "day", "board"],
  flow: ["none", "board"],
  financial: ["none", "board", "user", "day"],
};

export function isMetricCompatible(source: ReportSource, metric: ReportMetric): boolean {
  return METRICS_BY_SOURCE[source].includes(metric);
}

export function isGroupByCompatible(source: ReportSource, groupBy: ReportGroupBy): boolean {
  return GROUP_BYS_BY_SOURCE[source].includes(groupBy);
}

/** Human label for the empty ("none") bucket and the grand total. */
const TOTAL_LABEL = "Total";

/** Reduce a set of facts to a single number for the given metric. */
function reduceMetric(facts: ReportFact[], metric: ReportMetric): number {
  switch (metric) {
    case "count":
      return facts.length;
    case "sum:estimate":
      return round1(sum(facts.map((f) => f.estimate)));
    case "sum:minutes":
      return Math.round(sum(facts.map((f) => f.minutes)));
    case "sum:spend":
      return toCents(sum(facts.map((f) => f.spend)));
    case "avg:cycle": {
      const cycles = facts
        .map((f) => f.cycleDays)
        .filter((d): d is number => d !== null);
      return cycles.length === 0 ? 0 : round1(sum(cycles) / cycles.length);
    }
  }
}

function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}

/**
 * A metric value as display text. Minutes render as `Xh Ym`, spend as money
 * (with the board currency when known), cycle in days, counts/points plain.
 * Pure so both the table and axis labels share one formatting.
 */
export function formatMetricValue(
  metric: ReportMetric,
  value: number,
  currency: string | null = null
): string {
  switch (metric) {
    case "sum:minutes": {
      const hours = Math.floor(value / 60);
      const mins = Math.round(value % 60);
      return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
    }
    case "sum:spend": {
      const money = value.toFixed(2);
      return currency ? `${money} ${currency}` : money;
    }
    case "avg:cycle":
      return `${round1(value)}d`;
    default:
      return String(value);
  }
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

/**
 * Aggregate facts into a report result. Buckets by `fact.group`; when
 * `groupBy === "none"` there is a single `Total` bucket. Points are ordered
 * chronologically for `day`, otherwise by descending value (largest first,
 * label as a stable tiebreak).
 */
export function runReport(spec: ReportSpec, facts: ReportFact[]): ReportResult {
  const total = reduceMetric(facts, spec.metric);

  if (spec.groupBy === "none") {
    return {
      metric: spec.metric,
      groupBy: spec.groupBy,
      viz: "table",
      points: facts.length === 0 ? [] : [{ label: TOTAL_LABEL, value: total }],
      total,
    };
  }

  const byGroup = new Map<string, ReportFact[]>();
  for (const fact of facts) {
    const key = fact.group === "" ? "—" : fact.group;
    const bucket = byGroup.get(key);
    if (bucket) bucket.push(fact);
    else byGroup.set(key, [fact]);
  }

  const points: ReportPoint[] = [];
  for (const [label, bucket] of byGroup) {
    points.push({ label, value: reduceMetric(bucket, spec.metric) });
  }

  if (spec.groupBy === "day") {
    points.sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
  } else {
    points.sort((a, b) => b.value - a.value || (a.label < b.label ? -1 : 1));
  }

  return { metric: spec.metric, groupBy: spec.groupBy, viz: "table", points, total };
}
