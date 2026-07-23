/**
 * Custom & financial reports (rocks 5.1 + 5.2).
 *
 * A `Report` is a *definition* stored in the `report` table (058); its results
 * are never stored — `runReport` (lib/report.ts) folds them at read time from
 * facts the repository gathers. A report reads one `ReportSource`, filters rows
 * with the reused saved-view predicate (`BoardFilter`), buckets them by
 * `ReportGroupBy`, and reduces each bucket with a `ReportMetric`. Financial
 * reports are just `source: "financial"`, `metric: "sum:spend"`.
 */
import type { BoardFilter } from "@/features/board/lib/filter";

export const REPORT_SOURCES = ["tasks", "time", "flow", "financial"] as const;
export type ReportSource = (typeof REPORT_SOURCES)[number];

export const REPORT_GROUP_BYS = [
  "none",
  "status",
  "assignee",
  "priority",
  "label",
  "board",
  "user",
  "day",
] as const;
export type ReportGroupBy = (typeof REPORT_GROUP_BYS)[number];

export const REPORT_METRICS = [
  "count",
  "sum:estimate",
  "sum:minutes",
  "avg:cycle",
  "sum:spend",
] as const;
export type ReportMetric = (typeof REPORT_METRICS)[number];

export const REPORT_VIZ = ["bar", "line", "table"] as const;
export type ReportViz = (typeof REPORT_VIZ)[number];

export const REPORT_VISIBILITY = ["private", "shared"] as const;
export type ReportVisibility = (typeof REPORT_VISIBILITY)[number];

export const REPORT_NAME_MAX = 60;

/** A stored report definition. */
export interface Report {
  id: number;
  workspaceId: string;
  /** null = cross-board (the whole workspace, via the portfolio query). */
  boardId: number | null;
  createdBy: string;
  name: string;
  source: ReportSource;
  filter: BoardFilter;
  groupBy: ReportGroupBy;
  metric: ReportMetric;
  viz: ReportViz;
  visibility: ReportVisibility;
  createdAt: string;
  updatedAt: string;
  /** true when the caller may edit/delete this report (owner, or admin+ if shared). */
  canManage: boolean;
}

/** The report spec `runReport` consumes — the subset that drives aggregation. */
export type ReportSpec = Pick<Report, "source" | "groupBy" | "metric">;

export interface CreateReportInput {
  name: string;
  boardId?: number | null;
  source: ReportSource;
  filter?: BoardFilter;
  groupBy?: ReportGroupBy;
  metric: ReportMetric;
  viz?: ReportViz;
  visibility?: ReportVisibility;
}

/** Update: undefined leaves a field, a value replaces it. */
export interface UpdateReportInput {
  name?: string;
  boardId?: number | null;
  source?: ReportSource;
  filter?: BoardFilter;
  groupBy?: ReportGroupBy;
  metric?: ReportMetric;
  viz?: ReportViz;
  visibility?: ReportVisibility;
}

/**
 * One fact the repository hands to `runReport`: a pre-bucketed row carrying
 * every measure a metric might read. The repository fills only the measures its
 * source produces (tasks fill `estimate`; time/financial fill `minutes`/`spend`;
 * flow fills `cycleDays`); unused measures stay 0/null and are ignored by the
 * chosen metric.
 */
export interface ReportFact {
  /** The bucket label (already resolved from group_by; "" when group_by=none). */
  group: string;
  estimate: number;
  minutes: number;
  spend: number;
  cycleDays: number | null;
}

/** One aggregated bucket. */
export interface ReportPoint {
  label: string;
  value: number;
}

/** The computed result of a report. */
export interface ReportResult {
  metric: ReportMetric;
  groupBy: ReportGroupBy;
  viz: ReportViz;
  points: ReportPoint[];
  /** The metric applied across every fact (the grand total / overall value). */
  total: number;
}
