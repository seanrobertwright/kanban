"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { PriorityDot } from "@/features/tasks/components/task-card";
import type { Task } from "@/features/tasks/types";
import { useToday } from "@/shared/lib/due-date";
import { Button } from "@/shared/ui/button";
import type { BoardViewProps } from "./list-view";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * The board's tasks laid out by due date. Only the grid's *layout* touches Date
 * (which weekday a month starts on, how many days it has) — the tasks are still
 * bucketed by their 'YYYY-MM-DD' string, never parsed into a Date, so the same
 * off-by-one-timezone trap 006 and due-date.ts avoid stays avoided here too.
 *
 * A dated task appears in its day's cell; an undated one has no place on a
 * calendar and is listed below the grid rather than dropped.
 */
export function CalendarView({
  columns,
  itemsByColumn,
  onEditTask,
}: BoardViewProps) {
  const today = useToday();
  // Months away from the current one. 0 until the user pages; the current month
  // is not known until `today` resolves after mount (see useToday).
  const [offset, setOffset] = useState(0);

  const tasks = useMemo(
    () => columns.flatMap((c) => itemsByColumn[c.id] ?? []),
    [columns, itemsByColumn]
  );
  const byDate = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const t of tasks) {
      if (!t.dueDate) continue;
      const list = map.get(t.dueDate);
      if (list) list.push(t);
      else map.set(t.dueDate, [t]);
    }
    return map;
  }, [tasks]);
  const undated = useMemo(() => tasks.filter((t) => !t.dueDate), [tasks]);

  // Pre-mount (SSR and first client render), `today` is null — render a stable
  // skeleton so the grid appears only once the reader's month is known.
  if (!today) return <div className="min-h-96 rounded-lg border" aria-hidden />;

  const [ty, tm] = today.split("-").map(Number); // current year, month (1–12)
  const base = tm - 1 + offset; // months since ty-January
  const year = ty + Math.floor(base / 12);
  const monthIndex = ((base % 12) + 12) % 12; // 0–11

  const firstWeekday = new Date(year, monthIndex, 1).getDay(); // 0 = Sunday
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  // Leading blanks to align day 1 under its weekday, then each day of the month.
  const cells: (number | null)[] = [
    ...Array(firstWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  return (
    <div className="grid gap-3">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-medium">
          {MONTH_NAMES[monthIndex]} {year}
        </h2>
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            className="size-7"
            aria-label="Previous month"
            onClick={() => setOffset((o) => o - 1)}
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7"
            disabled={offset === 0}
            onClick={() => setOffset(0)}
          >
            Today
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="size-7"
            aria-label="Next month"
            onClick={() => setOffset((o) => o + 1)}
          >
            <ChevronRight />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border bg-border">
        {WEEKDAYS.map((d) => (
          <div
            key={d}
            className="bg-muted/50 px-2 py-1 text-center text-xs font-medium text-muted-foreground"
          >
            {d}
          </div>
        ))}
        {cells.map((day, i) => {
          if (day === null) {
            return <div key={`blank-${i}`} className="min-h-24 bg-background" />;
          }
          const date = `${year}-${pad(monthIndex + 1)}-${pad(day)}`;
          const dayTasks = byDate.get(date) ?? [];
          const isToday = date === today;
          return (
            <div key={date} className="min-h-24 bg-background p-1">
              <div
                className={`mb-1 flex h-5 w-5 items-center justify-center rounded-full text-xs tabular-nums ${
                  isToday
                    ? "bg-primary font-medium text-primary-foreground"
                    : "text-muted-foreground"
                }`}
              >
                {day}
              </div>
              <div className="grid gap-0.5">
                {dayTasks.map((task) => (
                  <button
                    key={task.id}
                    type="button"
                    onClick={() => onEditTask(task)}
                    title={task.title}
                    className="flex items-center gap-1 truncate rounded bg-muted/60 px-1.5 py-0.5 text-left text-xs hover:bg-muted"
                  >
                    <PriorityDot priority={task.priority} />
                    <span className="truncate">{task.title}</span>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {undated.length > 0 && (
        <div className="grid gap-1.5">
          <p className="text-xs font-medium text-muted-foreground">
            No due date ({undated.length})
          </p>
          <div className="flex flex-wrap gap-1">
            {undated.map((task) => (
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
      )}
    </div>
  );
}
