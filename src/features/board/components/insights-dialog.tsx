"use client";

import { useEffect, useState } from "react";

import type { AgentSummary } from "@/features/agents/types";
import type { Member } from "@/features/workspaces/types";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { fetchBoardAnalytics } from "../client/api";
import type { BoardAnalytics, Column, FlowStats } from "../types";

interface InsightsDialogProps {
  boardId: number;
  open: boolean;
  columns: Column[];
  membersById: Record<string, Member>;
  agentsById: Record<string, AgentSummary>;
  onOpenChange: (open: boolean) => void;
}

/**
 * The board's numbers — lead time, cycle time, throughput, cumulative flow,
 * and workload — in a dialog rather than a fourth view mode, deliberately:
 * 015's saved views persist a view_mode the database CHECKs, and a dashboard
 * is something you glance at and close, not a lens you file a saved filter
 * under. All charts are inline SVG: a dependency for four rectangles and a
 * stacked area would be the heaviest thing on the page.
 */

/** A stable, spaced hue per column index — presentation, so client-side. */
function columnColor(index: number, total: number): string {
  const hue = Math.round((index * 360) / Math.max(total, 1));
  return `hsl(${hue} 60% 55%)`;
}

function StatTile({ label, stats }: { label: string; stats: FlowStats }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums">
        {stats.avgDays}d
        <span className="ml-1 text-xs font-normal text-muted-foreground">
          avg
        </span>
      </p>
      <p className="text-xs text-muted-foreground tabular-nums">
        median {stats.medianDays}d · {stats.count} done
      </p>
    </div>
  );
}

function ThroughputChart({
  weeks,
}: {
  weeks: { weekStart: string; count: number }[];
}) {
  const max = Math.max(...weeks.map((w) => w.count), 1);
  const barWidth = 100 / weeks.length;
  return (
    <svg
      viewBox="0 0 100 40"
      className="h-24 w-full"
      role="img"
      aria-label={`Completions per week: ${weeks.map((w) => w.count).join(", ")}`}
    >
      {weeks.map((week, i) => {
        const height = (week.count / max) * 34;
        return (
          <g key={week.weekStart}>
            <rect
              x={i * barWidth + 1}
              y={38 - height}
              width={barWidth - 2}
              height={height}
              rx={1}
              className="fill-primary"
            >
              <title>{`Week of ${week.weekStart}: ${week.count} done`}</title>
            </rect>
          </g>
        );
      })}
      <line x1="0" y1="38.5" x2="100" y2="38.5" className="stroke-border" strokeWidth="0.5" />
    </svg>
  );
}

function VelocityChart({
  sprints,
}: {
  sprints: { sprintId: number; name: string; points: number }[];
}) {
  const max = Math.max(...sprints.map((s) => s.points), 1);
  const avg =
    Math.round(
      (sprints.reduce((s, v) => s + v.points, 0) / sprints.length) * 10
    ) / 10;
  const barWidth = 100 / sprints.length;
  const avgY = 38 - (avg / max) * 34;
  return (
    <div className="grid gap-1.5">
      <svg
        viewBox="0 0 100 40"
        className="h-24 w-full"
        role="img"
        aria-label={`Points completed per sprint: ${sprints.map((s) => s.points).join(", ")}. Average ${avg}.`}
      >
        {sprints.map((sprint, i) => {
          const height = (sprint.points / max) * 34;
          return (
            <rect
              key={sprint.sprintId}
              x={i * barWidth + 1}
              y={38 - height}
              width={barWidth - 2}
              height={height}
              rx={1}
              className="fill-primary"
            >
              <title>{`${sprint.name}: ${sprint.points} pts`}</title>
            </rect>
          );
        })}
        <line x1="0" y1="38.5" x2="100" y2="38.5" className="stroke-border" strokeWidth="0.5" />
        <line
          x1="0"
          y1={avgY}
          x2="100"
          y2={avgY}
          className="stroke-muted-foreground"
          strokeWidth="0.5"
          strokeDasharray="2 1.5"
        />
      </svg>
      <p className="text-xs text-muted-foreground tabular-nums">
        Average {avg} pts across {sprints.length} sprint
        {sprints.length === 1 ? "" : "s"}
      </p>
    </div>
  );
}

function BurndownChart({
  burndown,
}: {
  burndown: NonNullable<BoardAnalytics["burndown"]>;
}) {
  const { days, committed, endDate } = burndown;
  const actual = days.filter(
    (d): d is { date: string; remaining: number } => d.remaining !== null
  );
  const max = Math.max(committed, ...actual.map((d) => d.remaining), 1);
  const x = (i: number) => (i / Math.max(days.length - 1, 1)) * 100;
  const y = (v: number) => 38 - (v / max) * 34;

  // The ideal guideline runs committed → 0 over the planned window; its end is
  // the day matching endDate (the last sample when a sprint has overrun).
  const idealEnd = days.findIndex((d) => d.date === endDate);
  const idealEndIdx = idealEnd === -1 ? days.length - 1 : idealEnd;

  const actualPath = actual
    .map((d, i) => `${i === 0 ? "M" : "L"} ${x(days.indexOf(d))} ${y(d.remaining)}`)
    .join(" ");
  const current = actual.at(-1)?.remaining ?? committed;

  return (
    <div className="grid gap-1.5">
      <svg
        viewBox="0 0 100 40"
        className="h-28 w-full"
        role="img"
        aria-label={`Burndown: ${committed} points committed, ${current} remaining.`}
      >
        <line
          x1={x(0)}
          y1={y(committed)}
          x2={x(idealEndIdx)}
          y2={y(0)}
          className="stroke-muted-foreground"
          strokeWidth="0.5"
          strokeDasharray="2 1.5"
        />
        <path
          d={actualPath}
          fill="none"
          className="stroke-primary"
          strokeWidth="1"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <line x1="0" y1="38.5" x2="100" y2="38.5" className="stroke-border" strokeWidth="0.5" />
      </svg>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground tabular-nums">
        <span className="flex items-center gap-1">
          <span className="h-px w-3 bg-primary" aria-hidden="true" />
          {current} pts left
        </span>
        <span className="flex items-center gap-1">
          <span
            className="h-px w-3 bg-muted-foreground"
            style={{ opacity: 0.7 }}
            aria-hidden="true"
          />
          ideal from {committed}
        </span>
      </div>
    </div>
  );
}

function CumulativeFlowChart({
  cfd,
  columns,
}: {
  cfd: BoardAnalytics["cfd"];
  columns: Column[];
}) {
  // Stacked areas, bottom-up in board order, so the leftmost column sits at
  // the base — the reading every CFD teaches.
  const totals = cfd.map((day) =>
    columns.reduce((s, c) => s + (day.counts[c.id] ?? 0), 0)
  );
  const max = Math.max(...totals, 1);
  const x = (i: number) => (i / Math.max(cfd.length - 1, 1)) * 100;
  const y = (v: number) => 40 - (v / max) * 36;

  // For each column, the running stack under and including it, per day.
  const layers = columns.map((_, ci) =>
    cfd.map((day) =>
      columns
        .slice(0, ci + 1)
        .reduce((s, c) => s + (day.counts[c.id] ?? 0), 0)
    )
  );

  return (
    <div className="grid gap-1.5">
      <svg
        viewBox="0 0 100 40"
        className="h-32 w-full"
        role="img"
        aria-label="Cumulative flow, last 30 days"
      >
        {columns.map((column, ci) => {
          const upper = layers[ci];
          const lower = ci === 0 ? cfd.map(() => 0) : layers[ci - 1];
          const path =
            `M ${x(0)} ${y(lower[0])} ` +
            lower.map((v, i) => `L ${x(i)} ${y(v)}`).join(" ") +
            " " +
            [...upper]
              .map((v, i) => ({ v, i }))
              .reverse()
              .map(({ v, i }) => `L ${x(i)} ${y(v)}`)
              .join(" ") +
            " Z";
          return (
            <path
              key={column.id}
              d={path}
              fill={columnColor(ci, columns.length)}
              fillOpacity={0.75}
            >
              <title>{column.title}</title>
            </path>
          );
        })}
      </svg>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {columns.map((column, ci) => (
          <span
            key={column.id}
            className="flex items-center gap-1 text-xs text-muted-foreground"
          >
            <span
              className="size-2 rounded-sm"
              style={{ background: columnColor(ci, columns.length) }}
              aria-hidden="true"
            />
            {column.title}
          </span>
        ))}
      </div>
    </div>
  );
}

export function InsightsDialog({
  boardId,
  open,
  columns,
  membersById,
  agentsById,
  onOpenChange,
}: InsightsDialogProps) {
  const [data, setData] = useState<BoardAnalytics | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fetched per open, the load-on-open shape every dialog here uses: the
  // numbers must reflect the board as it is now, not as it was at mount.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const analytics = await fetchBoardAnalytics(boardId);
        if (!cancelled) setData(analytics);
      } catch (e) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "Could not load insights");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, boardId]);

  function assigneeName(
    type: "human" | "agent" | null,
    id: string | null
  ): string {
    if (type === null || id === null) return "Unassigned";
    if (type === "agent") return agentsById[id]?.name ?? "An agent";
    return membersById[id]?.name ?? "A removed user";
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Board insights</DialogTitle>
          <DialogDescription>
            Flow metrics replayed from this board’s full history.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {!data && !error && (
          <p className="text-sm text-muted-foreground">Crunching the log…</p>
        )}

        {data && (
          <div className="grid gap-4">
            {data.leadTime && data.cycleTime ? (
              <div className="grid grid-cols-2 gap-3">
                <StatTile label="Lead time (created → done)" stats={data.leadTime} />
                <StatTile
                  label="Cycle time (started → done)"
                  stats={data.cycleTime}
                />
              </div>
            ) : (
              <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
                Designate a done column (column menu → “Set as done column”) to
                unlock lead time, cycle time, and throughput — without one this
                board has no notion of “finished”.
              </p>
            )}

            {data.throughput && (
              <div className="grid gap-1">
                <p className="text-xs font-medium text-muted-foreground">
                  Throughput — completions per week
                </p>
                <ThroughputChart weeks={data.throughput} />
              </div>
            )}

            {data.burndown && (
              <div className="grid gap-1">
                <p className="text-xs font-medium text-muted-foreground">
                  Burndown — {data.burndown.name}
                </p>
                <BurndownChart burndown={data.burndown} />
              </div>
            )}

            {data.velocity.length > 0 && (
              <div className="grid gap-1">
                <p className="text-xs font-medium text-muted-foreground">
                  Velocity — points completed per sprint
                </p>
                <VelocityChart sprints={data.velocity} />
              </div>
            )}

            <div className="grid gap-1">
              <p className="text-xs font-medium text-muted-foreground">
                Cumulative flow — last 30 days
              </p>
              <CumulativeFlowChart cfd={data.cfd} columns={columns} />
            </div>

            <div className="grid gap-1">
              <p className="text-xs font-medium text-muted-foreground">
                Workload — open tasks by assignee
              </p>
              {data.workload.length === 0 ? (
                <p className="text-xs text-muted-foreground">No tasks yet.</p>
              ) : (
                <table className="w-full text-sm">
                  <tbody>
                    {data.workload.map((row) => (
                      <tr
                        key={`${row.assigneeType}-${row.assigneeId}`}
                        className="border-b last:border-0"
                      >
                        <td className="py-1.5">
                          {assigneeName(row.assigneeType, row.assigneeId)}
                          {row.assigneeType === "agent" && (
                            <span className="ml-1 text-xs text-muted-foreground">
                              (agent)
                            </span>
                          )}
                        </td>
                        <td className="py-1.5 text-right tabular-nums">
                          {row.count} task{row.count === 1 ? "" : "s"}
                        </td>
                        <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                          {row.points} pts
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
