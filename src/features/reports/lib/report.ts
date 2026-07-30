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
  financial: ["sum:spend", "forecast:spend"],
};

/** Which groupings each source supports. */
export const GROUP_BYS_BY_SOURCE: Record<ReportSource, ReportGroupBy[]> = {
  tasks: ["none", "status", "assignee", "priority", "label", "board"],
  time: ["none", "user", "day", "board"],
  flow: ["none", "board"],
  financial: ["none", "board", "user", "day"],
};

/**
 * A metric may narrow its source's groupings further. Only the forecast does:
 * its facts come from two populations at once — time entries (the spend) and
 * tasks (the points) — so a bucket label is only meaningful where *both* can be
 * labelled. A board can label either; a user or a day can label a time entry but
 * not a task's remaining points, which would forecast against an empty
 * denominator and report a confident zero.
 */
export const GROUP_BYS_BY_METRIC: Partial<Record<ReportMetric, ReportGroupBy[]>> = {
  "forecast:spend": ["none", "board"],
};

export function isMetricCompatible(source: ReportSource, metric: ReportMetric): boolean {
  return METRICS_BY_SOURCE[source].includes(metric);
}

/** The groupings legal for a source, narrowed by the metric when it narrows. */
export function groupBysFor(
  source: ReportSource,
  metric: ReportMetric
): ReportGroupBy[] {
  const byMetric = GROUP_BYS_BY_METRIC[metric];
  const bySource = GROUP_BYS_BY_SOURCE[source];
  return byMetric ? bySource.filter((g) => byMetric.includes(g)) : bySource;
}

/** `metric` is optional so callers checking a source alone keep working; when
 *  given, the metric's own restriction applies too. */
export function isGroupByCompatible(
  source: ReportSource,
  groupBy: ReportGroupBy,
  metric?: ReportMetric
): boolean {
  return metric
    ? groupBysFor(source, metric).includes(groupBy)
    : GROUP_BYS_BY_SOURCE[source].includes(groupBy);
}

/**
 * Projected spend at completion: what a bucket has already spent, plus the rate
 * it spent it at applied to the work still open. The rate is money per delivered
 * story point — spend/donePoints — which is the only rate the app can observe
 * without asking anyone to enter one (a per-task budget would be a second,
 * unmaintained number, and calendar burn-rate would forecast time, not work).
 *
 * Two honest degenerate cases:
 * - Nothing open: the forecast is the spend. There is no work left to project.
 * - Nothing delivered yet: there is no rate. The projection adds nothing it can
 *   justify, so it also reports the spend to date — an understatement the caller
 *   can see through (a forecast equal to spend with points still open means "too
 *   early to say"), rather than an invented number.
 */
export function forecastSpend(
  spend: number,
  donePoints: number,
  openPoints: number
): number {
  if (openPoints <= 0 || donePoints <= 0) return spend;
  return spend + (spend / donePoints) * openPoints;
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
    case "forecast:spend":
      // A ratio between two aggregates, not a fold over rows — so it sums each
      // measure across the bucket first and divides once.
      return toCents(
        forecastSpend(
          sum(facts.map((f) => f.spend)),
          sum(facts.map((f) => f.donePoints)),
          sum(facts.map((f) => f.openPoints))
        )
      );
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
    case "sum:spend":
    case "forecast:spend": {
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
