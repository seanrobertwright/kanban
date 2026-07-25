"use client";

import { useMemo, type CSSProperties } from "react";
import { TriangleAlert } from "lucide-react";

import type { Task } from "@/features/tasks/types";
import { useToday } from "@/shared/lib/due-date";
import type { Column } from "../types";

interface DashboardViewProps {
  columns: Column[];
  itemsByColumn: Record<number, Task[]>;
  /** The completion column (020), if the board named one — the "done" in every
   *  percentage below. null degrades the tiles honestly rather than guessing. */
  doneColumnId: number | null;
  onEditTask: (task: Task) => void;
}

/** Mirrors BoardColumn's identity-dot assignment so the rollup rows and the
 *  board agree about which colour a column is. */
const COLUMN_ACCENTS = [
  "var(--neon-cyan)",
  "var(--neon-orange)",
  "var(--neon-magenta)",
  "var(--neon-purple)",
  "var(--neon-green)",
];

/**
 * The dashboard lens (072): the mockup's stat tiles, column rollup, and
 * at-risk list — every number derived on render from the tasks the board
 * already holds. No fetch, no stored aggregate, the analytics rule applied
 * to a view: stored facts in, presentation out.
 */
export function DashboardView({
  columns,
  itemsByColumn,
  doneColumnId,
  onEditTask,
}: DashboardViewProps) {
  const today = useToday();

  const {
    total,
    doneCount,
    donePct,
    totalPoints,
    donePoints,
    atRisk,
  } = useMemo(() => {
    const all = columns.flatMap((c) => itemsByColumn[c.id] ?? []);
    const done =
      doneColumnId === null ? [] : (itemsByColumn[doneColumnId] ?? []);
    const doneIds = new Set(done.map((t) => t.id));
    const sum = (tasks: Task[]) =>
      tasks.reduce((n, t) => n + (t.estimate ?? 0), 0);
    // A done task is not "at risk" no matter what its due date says — risk is
    // about work still in flight.
    const atRisk = all
      .filter((t) => !doneIds.has(t.id))
      .flatMap((t) => {
        const overdue =
          today != null && t.dueDate != null && t.dueDate < today;
        if (overdue)
          return [{ task: t, tag: "OVERDUE", reason: `due ${t.dueDate}` }];
        if (t.blockedByOpenCount > 0)
          return [
            {
              task: t,
              tag: "BLOCKED",
              reason: `waiting on ${t.blockedByOpenCount}`,
            },
          ];
        return [];
      });
    return {
      total: all.length,
      doneCount: done.length,
      donePct: all.length ? Math.round((done.length / all.length) * 100) : 0,
      totalPoints: sum(all),
      donePoints: sum(done),
      atRisk,
    };
  }, [columns, itemsByColumn, doneColumnId, today]);

  const hasDone = doneColumnId !== null;
  const stats = [
    {
      label: "Tasks",
      value: String(total),
      sub: `across ${columns.length} column${columns.length === 1 ? "" : "s"}`,
      color: "var(--neon-cyan)",
    },
    {
      label: "Completed",
      value: hasDone ? `${donePct}%` : "—",
      sub: hasDone ? `${doneCount} / ${total} tasks` : "no done column set",
      color: "var(--neon-green)",
    },
    {
      label: "Points",
      value: String(totalPoints),
      sub: hasDone ? `${donePoints} delivered` : "estimated scope",
      color: "var(--neon-orange)",
    },
    {
      label: "At Risk",
      value: String(atRisk.length),
      sub: "overdue / blocked",
      color: "var(--neon-red)",
    },
  ];

  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="rounded-xl bg-card p-4 ring-1 ring-foreground/10 dark:bg-linear-to-b dark:from-[#0a121c] dark:to-[#070c14] dark:ring-primary/20"
          >
            <div className="label-mono mb-2 text-muted-foreground">
              {stat.label}
            </div>
            <div
              className="font-heading text-3xl leading-none font-bold dark:text-glow"
              style={{ color: stat.color } as CSSProperties}
            >
              {stat.value}
            </div>
            <div className="mt-1.5 text-xs text-muted-foreground">
              {stat.sub}
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-xl bg-card p-4 ring-1 ring-foreground/10 dark:bg-linear-to-b dark:from-[#0a121c] dark:to-[#070c14] dark:ring-primary/20">
        <div className="label-mono mb-3 text-muted-foreground">
          Column Rollup
        </div>
        <div className="grid gap-3">
          {columns.map((column) => {
            const count = (itemsByColumn[column.id] ?? []).length;
            const pct = total ? Math.round((count / total) * 100) : 0;
            const accent =
              column.id === doneColumnId
                ? "var(--neon-green)"
                : COLUMN_ACCENTS[column.id % COLUMN_ACCENTS.length];
            return (
              <div key={column.id}>
                <div className="mb-1 flex justify-between text-xs">
                  <span className="truncate font-medium">{column.title}</span>
                  <span
                    className="ml-2 shrink-0 font-mono tabular-nums"
                    style={{ color: accent } as CSSProperties}
                  >
                    {count} · {pct}%
                  </span>
                </div>
                <div
                  className="h-1.5 overflow-hidden rounded-full bg-secondary"
                  role="progressbar"
                  aria-label={`${column.title}: ${count} of ${total} tasks`}
                  aria-valuenow={pct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div
                    className="h-full rounded-full transition-all"
                    style={
                      {
                        width: `${pct}%`,
                        background: accent,
                        boxShadow: `0 0 8px color-mix(in srgb, ${accent} 55%, transparent)`,
                      } as CSSProperties
                    }
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10 dark:bg-linear-to-b dark:from-[#0a121c] dark:to-[#070c14] dark:ring-primary/20">
        <div className="label-mono flex items-center gap-2 px-4 pt-4 pb-2 text-muted-foreground">
          <TriangleAlert className="size-3.5 text-neon-orange" aria-hidden />
          At Risk · Needs Attention
        </div>
        {atRisk.length === 0 ? (
          <p className="px-4 pb-4 text-sm text-muted-foreground">
            Nothing overdue or blocked. Clear skies.
          </p>
        ) : (
          <ul>
            {atRisk.map(({ task, tag, reason }) => (
              <li key={task.id}>
                <button
                  type="button"
                  className="flex w-full items-center gap-3 border-t px-4 py-2.5 text-left transition-colors hover:bg-accent/50"
                  onClick={() => onEditTask(task)}
                >
                  <span className="shrink-0 font-mono text-xs text-primary">
                    #{task.id}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {task.title}
                  </span>
                  <span
                    className={`label-mono shrink-0 rounded-sm border px-2 py-0.5 ${
                      tag === "OVERDUE"
                        ? "border-destructive/40 bg-destructive/10 text-destructive"
                        : "border-neon-orange/40 bg-neon-orange/10 text-neon-orange"
                    }`}
                  >
                    {tag}
                  </span>
                  <span className="hidden shrink-0 font-mono text-xs text-muted-foreground sm:inline">
                    {reason}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
