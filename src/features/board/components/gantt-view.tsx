"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { TaskDependencyEdge } from "@/features/dependencies/types";
import { PriorityDot } from "@/features/tasks/components/task-card";
import type { Task } from "@/features/tasks/types";
import { useToday } from "@/shared/lib/due-date";
import {
  addDays,
  criticalPath,
  dayDiff,
  durationOf,
  edgeKey,
  shortLabel,
  spanOf,
} from "../lib/schedule";
import type { BoardViewProps } from "./list-view";

/** One row's fixed height in px — the arrows read row centres off it, so it is a
 *  constant rather than a gap-driven layout whose centres would need measuring. */
const ROW_H = 32;

export interface GanttViewProps extends BoardViewProps {
  /** Every blocked-by edge on the board (036) — the arrows and critical path. */
  dependencies: TaskDependencyEdge[];
}

interface Placed {
  task: Task;
  span: [string, string];
  /** Row index — its vertical slot, also the arrow's y anchor. */
  row: number;
  /** Bar geometry as fractions of the window [0, 1]. */
  left: number;
  width: number;
}

/**
 * The Gantt (036): the Timeline's bars with the dependency graph drawn over
 * them. Each dated task is a bar from its start to its due date; an arrow runs
 * from a blocker's bar to the work it blocks (018), and the critical path — the
 * longest chain of dependent work, the schedule's driving edge — is highlighted.
 *
 * Bars are placed by percentage of the tasks' own window, the Timeline's trick
 * for drawing a year without rendering 365 columns. The arrows cannot live in
 * that percentage space: an SVG path needs real coordinates, and a diagonal in a
 * non-uniformly stretched viewBox would skew. So the track's pixel width is
 * measured (a ResizeObserver), and every arrow endpoint is computed in px from
 * the same fractions the bars use — bars and arrows then agree at any width.
 *
 * Rows are ordered by start date so dependent work tends to sit below its
 * blockers and the arrows read top-down. Undated tasks have no bar and are
 * listed below, the Timeline's (and the calendar's) rule for the same gap.
 */
export function GanttView({
  columns,
  itemsByColumn,
  dependencies,
  onEditTask,
}: GanttViewProps) {
  const today = useToday();
  const trackRef = useRef<HTMLDivElement>(null);
  const [trackWidth, setTrackWidth] = useState(0);

  // The track's pixel width — the one thing the arrows need that CSS percentages
  // cannot give them. Re-measured on resize so a dragged window or a rotated
  // phone keeps bars and arrows aligned.
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const measure = () => setTrackWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const tasks = useMemo(
    () => columns.flatMap((c) => itemsByColumn[c.id] ?? []),
    [columns, itemsByColumn]
  );

  const scheduled = useMemo(
    () =>
      tasks
        .map((task) => ({ task, span: spanOf(task) }))
        .filter((r): r is { task: Task; span: [string, string] } => r.span !== null)
        // Chronological by start, title breaking ties, so arrows run downward.
        .sort((a, b) =>
          a.span[0] === b.span[0]
            ? a.task.title.localeCompare(b.task.title)
            : a.span[0] < b.span[0]
              ? -1
              : 1
        ),
    [tasks]
  );
  const unscheduled = useMemo(
    () => tasks.filter((t) => !t.startDate && !t.dueDate),
    [tasks]
  );

  // The window: earliest start to latest end across scheduled tasks, padded two
  // days each side. Null when nothing is scheduled.
  const window = useMemo(() => {
    if (scheduled.length === 0) return null;
    let min = scheduled[0].span[0];
    let max = scheduled[0].span[1];
    for (const { span } of scheduled) {
      if (span[0] < min) min = span[0];
      if (span[1] > max) max = span[1];
    }
    const start = addDays(min, -2);
    const end = addDays(max, 2);
    return { start, end, total: dayDiff(start, end) + 1 };
  }, [scheduled]);

  // Every bar placed once — row, fractional left, fractional width — plus an
  // index from task id to its placement, which the arrows resolve endpoints
  // through. Computed together so bars and arrows cannot drift.
  const { placed, byId } = useMemo(() => {
    const list: Placed[] = [];
    const index = new Map<number, Placed>();
    if (window) {
      scheduled.forEach(({ task, span }, row) => {
        const offset = dayDiff(window.start, span[0]);
        const length = dayDiff(span[0], span[1]) + 1;
        const p: Placed = {
          task,
          span,
          row,
          left: offset / window.total,
          width: length / window.total,
        };
        list.push(p);
        index.set(task.id, p);
      });
    }
    return { placed: list, byId: index };
  }, [scheduled, window]);

  // The critical path, weighted by each bar's duration in days (036).
  const critical = useMemo(() => {
    const durations = new Map<number, number>();
    for (const p of placed) durations.set(p.task.id, durationOf(p.span));
    return criticalPath(durations, dependencies);
  }, [placed, dependencies]);

  // Arrows to draw: only edges whose both ends have a bar on screen (a blocker
  // that is a subtask, or filtered out, has no row to point from).
  const arrows = useMemo(
    () =>
      dependencies
        .map((e) => ({
          from: byId.get(e.dependsOnId),
          to: byId.get(e.taskId),
          critical: critical.edges.has(edgeKey(e.dependsOnId, e.taskId)),
        }))
        .filter((a): a is { from: Placed; to: Placed; critical: boolean } =>
          Boolean(a.from && a.to)
        ),
    [dependencies, byId, critical]
  );

  // Weekly gridlines: an offset per 7-day step, labelled with its date.
  const ticks = useMemo(() => {
    if (!window) return [];
    const out: { offset: number; label: string }[] = [];
    for (let d = 0; d < window.total; d += 7) {
      out.push({ offset: d, label: shortLabel(addDays(window.start, d)) });
    }
    return out;
  }, [window]);

  if (scheduled.length === 0) {
    return (
      <div className="grid gap-3">
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          No task has a start or due date yet. Add either to a task and it appears
          here as a bar; give one task a dependency and the Gantt draws the arrow.
        </p>
        {unscheduled.length > 0 && (
          <UnscheduledList tasks={unscheduled} onEditTask={onEditTask} />
        )}
      </div>
    );
  }

  const w = window!;
  const pct = (frac: number) => `${frac * 100}%`;
  const todayOffset =
    today && today >= w.start && today <= w.end ? dayDiff(w.start, today) : null;
  const height = placed.length * ROW_H;

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <h2 className="font-medium">Gantt</h2>
        <span className="text-muted-foreground">
          {shortLabel(w.start)} – {shortLabel(w.end)}
        </span>
        {critical.nodes.size > 0 && (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="h-2 w-4 rounded-sm bg-primary" />
            Critical path
          </span>
        )}
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[32rem]">
          {/* Header: weekly date ticks on the same fractional scale as the bars. */}
          <div className="relative mb-1 h-5 border-b">
            {ticks.map((t) => (
              <span
                key={t.offset}
                className="absolute -translate-x-1/2 text-[10px] tabular-nums text-muted-foreground"
                style={{ left: pct(t.offset / w.total) }}
              >
                {t.label}
              </span>
            ))}
          </div>

          {/* The track: gridlines, the arrow overlay, then the bars. Measured for
              its pixel width so the arrows can be drawn in real coordinates. */}
          <div
            ref={trackRef}
            className="relative"
            style={{ height }}
          >
            {/* Weekly gridlines + today marker, behind everything. */}
            <div className="pointer-events-none absolute inset-0" aria-hidden>
              {ticks.map((t) => (
                <span
                  key={t.offset}
                  className="absolute top-0 bottom-0 w-px bg-border/60"
                  style={{ left: pct(t.offset / w.total) }}
                />
              ))}
              {todayOffset !== null && (
                <span
                  className="absolute top-0 bottom-0 w-px bg-primary/70"
                  style={{ left: pct(todayOffset / w.total) }}
                />
              )}
            </div>

            {/* Dependency arrows, drawn in px once the track width is known. */}
            {trackWidth > 0 && arrows.length > 0 && (
              <svg
                className="pointer-events-none absolute inset-0"
                width={trackWidth}
                height={height}
                aria-hidden
              >
                <defs>
                  <marker
                    id="gantt-arrow"
                    markerWidth="6"
                    markerHeight="6"
                    refX="5"
                    refY="3"
                    orient="auto"
                  >
                    <path d="M0,0 L6,3 L0,6 Z" className="fill-muted-foreground" />
                  </marker>
                  <marker
                    id="gantt-arrow-critical"
                    markerWidth="6"
                    markerHeight="6"
                    refX="5"
                    refY="3"
                    orient="auto"
                  >
                    <path d="M0,0 L6,3 L0,6 Z" className="fill-primary" />
                  </marker>
                </defs>
                {arrows.map((a, i) => (
                  <path
                    key={i}
                    d={arrowPath(a.from, a.to, trackWidth)}
                    fill="none"
                    className={
                      a.critical
                        ? "stroke-primary"
                        : "stroke-muted-foreground/60"
                    }
                    strokeWidth={a.critical ? 1.75 : 1}
                    markerEnd={`url(#${
                      a.critical ? "gantt-arrow-critical" : "gantt-arrow"
                    })`}
                  />
                ))}
              </svg>
            )}

            {/* One bar per scheduled task. */}
            {placed.map((p) => {
              const single =
                p.task.startDate == null || p.task.dueDate == null;
              const isCritical = critical.nodes.has(p.task.id);
              return (
                <div
                  key={p.task.id}
                  className="absolute inset-x-0"
                  style={{ top: p.row * ROW_H, height: ROW_H }}
                >
                  <button
                    type="button"
                    onClick={() => onEditTask(p.task)}
                    title={`${p.task.title} · ${p.span[0]}${
                      p.span[0] === p.span[1] ? "" : ` → ${p.span[1]}`
                    }`}
                    className={`absolute top-1/2 flex h-5 -translate-y-1/2 items-center gap-1 overflow-hidden rounded px-1.5 text-left text-xs hover:ring-2 hover:ring-ring/50 ${
                      isCritical ? "ring-1 ring-primary" : ""
                    }`}
                    style={{
                      left: pct(p.left),
                      width: single ? undefined : pct(p.width),
                      minWidth: "1.5rem",
                      backgroundColor: isCritical
                        ? "var(--primary)"
                        : "var(--muted)",
                      color: isCritical
                        ? "var(--primary-foreground)"
                        : undefined,
                    }}
                  >
                    <PriorityDot priority={p.task.priority} />
                    <span className="truncate">{p.task.title}</span>
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {unscheduled.length > 0 && (
        <UnscheduledList tasks={unscheduled} onEditTask={onEditTask} />
      )}
    </div>
  );
}

/**
 * A finish-to-start connector from a blocker's bar to the work it blocks: out
 * from the blocker's right edge, an orthogonal elbow, into the dependent's left
 * edge. Coordinates in px — fractions × the measured track width for x, row
 * centres for y — so the path lands exactly on the bars CSS placed by percent.
 *
 * When the dependent starts before its blocker ends (a schedule conflict the
 * board does not forbid), x2 sits left of x1; the elbow still routes cleanly by
 * stepping out a fixed stub before turning back.
 */
function arrowPath(from: Placed, to: Placed, width: number): string {
  const x1 = (from.left + from.width) * width;
  const y1 = from.row * ROW_H + ROW_H / 2;
  const x2 = to.left * width;
  const y2 = to.row * ROW_H + ROW_H / 2;
  const stub = 10;
  const midX = Math.max(x1 + stub, x2 - stub);
  // Out from the blocker, across at a mid column, then into the dependent — an
  // orthogonal path that reads as "this then that" rather than a straight
  // diagonal through unrelated bars.
  return `M ${x1} ${y1} H ${midX} V ${y2} H ${x2}`;
}

/** Tasks with no start and no due date — nowhere to sit, listed rather than
 *  dropped (the Timeline's rule for its own undated tasks). */
function UnscheduledList({
  tasks,
  onEditTask,
}: {
  tasks: Task[];
  onEditTask: (task: Task) => void;
}) {
  return (
    <div className="grid gap-1.5">
      <p className="text-xs font-medium text-muted-foreground">
        Unscheduled ({tasks.length})
      </p>
      <div className="flex flex-wrap gap-1">
        {tasks.map((task) => (
          <button
            key={task.id}
            type="button"
            onClick={() => onEditTask(task)}
            title={task.title}
            className="flex max-w-48 items-center gap-1 truncate rounded border bg-background px-1.5 py-0.5 text-left text-xs hover:bg-muted/50"
          >
            <PriorityDot priority={task.priority} />
            <span className="truncate">{task.title}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
