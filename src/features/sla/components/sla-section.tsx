"use client";

import { useEffect, useState } from "react";

import { fetchTaskSla } from "../client/api";
import type { TaskSlaStatus } from "../types";

interface SlaSectionProps {
  taskId: number;
}

/** Minutes to a compact human span: 90 → "1h 30m", 45 → "45m", 26h+ → "1d 2h". */
function formatMins(total: number): string {
  const mins = Math.abs(total);
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  return `${m}m`;
}

/**
 * The task's SLA timers (SPEC 1.6) — a dialog section in TimeSection's shape:
 * self-fetching, keyed by task, read-only. One line per active policy timer:
 * the target, what remains (or how far past due), and the breach flag. Renders
 * nothing when the task has no timers, so it is inert on an un-SLA'd board.
 */
export function SlaSection({ taskId }: SlaSectionProps) {
  const [timers, setTimers] = useState<TaskSlaStatus[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchTaskSla(taskId);
        if (!cancelled) setTimers(data);
      } catch (e) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "Failed to load SLA");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [taskId]);

  if (!error && timers.length === 0) return null;

  return (
    <div className="grid gap-2">
      <p className="text-xs font-medium text-muted-foreground">SLA</p>

      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}

      {timers.length > 0 && (
        <ul className="grid gap-1">
          {timers.map((timer) => (
            <li
              key={timer.policyId}
              className="flex items-center justify-between gap-2 text-xs"
            >
              <span className="min-w-0 truncate text-muted-foreground">
                <span className="font-medium text-foreground">
                  {timer.policyName}
                </span>{" "}
                · due{" "}
                <time dateTime={timer.dueAt}>
                  {new Date(timer.dueAt).toLocaleString()}
                </time>
              </span>
              {timer.breached ? (
                <span className="shrink-0 rounded bg-destructive/10 px-1.5 py-0.5 font-medium text-destructive">
                  Breached
                  {timer.remainingMins < 0 &&
                    ` ${formatMins(timer.remainingMins)} ago`}
                </span>
              ) : (
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {formatMins(timer.remainingMins)} left
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
