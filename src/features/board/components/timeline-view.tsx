"use client";

import { useMemo } from "react";

import { PriorityDot } from "@/features/tasks/components/task-card";
import type { Task } from "@/features/tasks/types";
import { useToday } from "@/shared/lib/due-date";
import type { BoardViewProps } from "./list-view";

const MONTH_ABBR = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Date maths on 'YYYY-MM-DD' strings, kept in UTC so a zoneless calendar date
 * never drifts a day through the server's local zone — the trap 006, due-date.ts
 * and the calendar all avoid. Only the *window* touches Date here; a task's own
 * dates stay strings and are placed by day-count, never parsed into a Date.
 */
function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/** Whole days from `a` to `b` (b − a); negative when b precedes a. */
function dayDiff(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round(
    (Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000
  );
}

/** "Mar 3" — a short, zone-free label read straight off the string. */
function shortLabel(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${MONTH_ABBR[m - 1]} ${d}`;
}

/**
 * A task's span on the timeline: [start, end] as 'YYYY-MM-DD'. A task with both
 * dates spans them; one with only a start (or only a due) is a zero-length span
 * on that single day — the bar renders as a marker rather than nothing. Returns
 * null for a task with neither date, which has no place on a timeline.
 */
function spanOf(task: Task): [string, string] | null {
  const start = task.startDate ?? task.dueDate;
  const end = task.dueDate ?? task.startDate;
  if (!start || !end) return null;
  // Guard a backwards pair (start after due) by ordering lexicographically —
  // YYYY-MM-DD sorts as dates, so no Date is needed to compare them.
  return start <= end ? [start, end] : [end, start];
}

/**
 * The board's tasks as bars over time (032) — the one lens a single date could
 * not draw, because a span needs two. Each dated task is a row whose bar runs
 * from its start date to its due date; an undated task is listed below rather
 * than dropped, the calendar's rule for the same gap.
 *
 * Positioned by percentage rather than a per-day grid: a window can be a year
 * wide, and a bar's left/width as a share of the window places it without
 * rendering 365 columns. The window is the tasks' own extent, padded a little so
 * the earliest bar is not flush against the edge.
 */
export function TimelineView({
  columns,
  itemsByColumn,
  onEditTask,
}: BoardViewProps) {
  const today = useToday();

  const tasks = useMemo(
    () => columns.flatMap((c) => itemsByColumn[c.id] ?? []),
    [columns, itemsByColumn]
  );

  const scheduled = useMemo(
    () =>
      tasks
        .map((task) => ({ task, span: spanOf(task) }))
        .filter((r): r is { task: Task; span: [string, string] } => r.span !== null),
    [tasks]
  );
  const unscheduled = useMemo(
    () => tasks.filter((t) => !t.startDate && !t.dueDate),
    [tasks]
  );

  // The window: the earliest span-start to the latest span-end across all
  // scheduled tasks, padded two days each side. Null when nothing is scheduled.
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

  // Weekly gridlines: an offset (in days from the window start) per 7-day step,
  // labelled with its date. Cheap visual scaffolding so a bar's position reads.
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
          here as a bar on the timeline.
        </p>
        {unscheduled.length > 0 && (
          <UnscheduledList tasks={unscheduled} onEditTask={onEditTask} />
        )}
      </div>
    );
  }

  const w = window!;
  const pct = (n: number) => `${(n / w.total) * 100}%`;
  // Today's position, only when it falls inside the window.
  const todayOffset =
    today && today >= w.start && today <= w.end ? dayDiff(w.start, today) : null;

  return (
    <div className="grid gap-3">
      <div className="flex items-center gap-2 text-sm">
        <h2 className="font-medium">Timeline</h2>
        <span className="text-muted-foreground">
          {shortLabel(w.start)} – {shortLabel(w.end)}
        </span>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[32rem]">
          {/* Header: weekly date ticks across the track, aligned to the same
              percentage scale the bars use. */}
          <div className="relative mb-1 h-5 border-b">
            {ticks.map((t) => (
              <span
                key={t.offset}
                className="absolute -translate-x-1/2 text-[10px] tabular-nums text-muted-foreground"
                style={{ left: pct(t.offset) }}
              >
                {t.label}
              </span>
            ))}
          </div>

          {/* One row per scheduled task: title on the left, bar on the track. */}
          <div className="relative grid gap-1">
            {/* Weekly gridlines behind the bars. */}
            <div className="pointer-events-none absolute inset-0" aria-hidden>
              {ticks.map((t) => (
                <span
                  key={t.offset}
                  className="absolute top-0 bottom-0 w-px bg-border/60"
                  style={{ left: pct(t.offset) }}
                />
              ))}
              {todayOffset !== null && (
                <span
                  className="absolute top-0 bottom-0 w-px bg-primary/70"
                  style={{ left: pct(todayOffset) }}
                />
              )}
            </div>

            {scheduled.map(({ task, span }) => {
              const offset = dayDiff(w.start, span[0]);
              const length = dayDiff(span[0], span[1]) + 1;
              const single = task.startDate == null || task.dueDate == null;
              return (
                <div key={task.id} className="relative h-7">
                  <button
                    type="button"
                    onClick={() => onEditTask(task)}
                    title={`${task.title} · ${span[0]}${
                      span[0] === span[1] ? "" : ` → ${span[1]}`
                    }`}
                    className="absolute top-1/2 flex h-5 -translate-y-1/2 items-center gap-1 overflow-hidden rounded px-1.5 text-left text-xs hover:ring-2 hover:ring-ring/50"
                    style={{
                      left: pct(offset),
                      // A single-date task has no span to fill; give it a small
                      // fixed width so the marker is clickable rather than a sliver.
                      width: single ? undefined : pct(length),
                      minWidth: "1.5rem",
                      backgroundColor: "var(--muted)",
                    }}
                  >
                    <PriorityDot priority={task.priority} />
                    <span className="truncate">{task.title}</span>
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

/** Tasks with no start and no due date — nowhere to sit on a timeline, listed
 *  rather than dropped (the calendar's rule for its own undated tasks). */
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
