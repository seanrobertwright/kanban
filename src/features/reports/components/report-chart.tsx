"use client";

import { formatMetricValue } from "../lib/report";
import type { ReportMetric, ReportResult } from "../types";

/**
 * Renders a computed report as its chosen viz (bar | line | table), in the same
 * inline-SVG visual language the Insights dialog uses — no chart dependency, just
 * `<rect>`/`<path>` on a `0 0 100 40` canvas, themed by the same Tailwind tokens
 * (`fill-primary`, `stroke-border`). Empty results fall back to a quiet note.
 */
export function ReportChart({
  result,
  currency,
}: {
  result: ReportResult;
  currency: string | null;
}) {
  const fmt = (v: number) => formatMetricValue(result.metric, v, currency);

  if (result.points.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No data matches this report.
      </p>
    );
  }

  if (result.viz === "table") {
    return <ReportTable result={result} fmt={fmt} />;
  }
  if (result.viz === "line") {
    return <LineChart result={result} fmt={fmt} />;
  }
  return <BarChart result={result} fmt={fmt} />;
}

function ReportTable({
  result,
  fmt,
}: {
  result: ReportResult;
  fmt: (v: number) => string;
}) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b text-left text-xs text-muted-foreground">
          <th className="py-1.5 font-medium">{groupHeading(result.groupBy)}</th>
          <th className="py-1.5 text-right font-medium">{metricHeading(result.metric)}</th>
        </tr>
      </thead>
      <tbody>
        {result.points.map((p) => (
          <tr key={p.label} className="border-b last:border-0">
            <td className="py-1.5">{p.label}</td>
            <td className="py-1.5 text-right tabular-nums">{fmt(p.value)}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="font-medium">
          <td className="py-1.5">Total</td>
          <td className="py-1.5 text-right tabular-nums">{fmt(result.total)}</td>
        </tr>
      </tfoot>
    </table>
  );
}

function BarChart({
  result,
  fmt,
}: {
  result: ReportResult;
  fmt: (v: number) => string;
}) {
  const max = Math.max(...result.points.map((p) => p.value), 1);
  const barWidth = 100 / result.points.length;
  return (
    <div className="grid gap-1.5">
      <svg
        viewBox="0 0 100 40"
        className="h-40 w-full"
        role="img"
        aria-label={`${metricHeading(result.metric)} by ${groupHeading(result.groupBy)}`}
        preserveAspectRatio="none"
      >
        {result.points.map((p, i) => {
          const height = (p.value / max) * 34;
          return (
            <rect
              key={p.label}
              x={i * barWidth + 1}
              y={38 - height}
              width={barWidth - 2}
              height={height}
              rx={1}
              className="fill-primary"
            >
              <title>{`${p.label}: ${fmt(p.value)}`}</title>
            </rect>
          );
        })}
        <line x1="0" y1="38.5" x2="100" y2="38.5" className="stroke-border" strokeWidth="0.5" />
      </svg>
      <Legend result={result} fmt={fmt} />
    </div>
  );
}

function LineChart({
  result,
  fmt,
}: {
  result: ReportResult;
  fmt: (v: number) => string;
}) {
  const pts = result.points;
  const max = Math.max(...pts.map((p) => p.value), 1);
  const stepX = pts.length > 1 ? 100 / (pts.length - 1) : 0;
  const coords = pts.map((p, i) => {
    const x = pts.length > 1 ? i * stepX : 50;
    const y = 38 - (p.value / max) * 34;
    return { ...p, x, y };
  });
  const path = coords
    .map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(2)} ${c.y.toFixed(2)}`)
    .join(" ");
  return (
    <div className="grid gap-1.5">
      <svg
        viewBox="0 0 100 40"
        className="h-40 w-full"
        role="img"
        aria-label={`${metricHeading(result.metric)} over ${groupHeading(result.groupBy)}`}
      >
        <path d={path} fill="none" className="stroke-primary" strokeWidth="1" />
        {coords.map((c) => (
          <circle key={c.label} cx={c.x} cy={c.y} r="0.9" className="fill-primary">
            <title>{`${c.label}: ${fmt(c.value)}`}</title>
          </circle>
        ))}
        <line x1="0" y1="38.5" x2="100" y2="38.5" className="stroke-border" strokeWidth="0.5" />
      </svg>
      <Legend result={result} fmt={fmt} />
    </div>
  );
}

/** A compact key of the buckets so a dependency-free chart stays readable. */
function Legend({
  result,
  fmt,
}: {
  result: ReportResult;
  fmt: (v: number) => string;
}) {
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
      {result.points.map((p) => (
        <li key={p.label} className="tabular-nums">
          <span className="text-foreground">{p.label}</span> {fmt(p.value)}
        </li>
      ))}
    </ul>
  );
}

function groupHeading(groupBy: ReportResult["groupBy"]): string {
  switch (groupBy) {
    case "none":
      return "All";
    case "status":
      return "Status";
    case "assignee":
      return "Assignee";
    case "priority":
      return "Priority";
    case "label":
      return "Label";
    case "board":
      return "Board";
    case "user":
      return "Member";
    case "day":
      return "Day";
  }
}

function metricHeading(metric: ReportMetric): string {
  switch (metric) {
    case "count":
      return "Tasks";
    case "sum:estimate":
      return "Estimate";
    case "sum:minutes":
      return "Time";
    case "avg:cycle":
      return "Avg cycle";
    case "sum:spend":
      return "Spend";
  }
}
