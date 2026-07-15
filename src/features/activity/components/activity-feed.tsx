"use client";

import { useEffect, useState } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/shared/ui/avatar";
import { fetchTaskActivity } from "../client/api";
import type { ActivityEntry } from "../types";

interface ActivityFeedProps {
  taskId: number;
  /** Column titles by id, for naming the columns a task moved between. */
  columnNames: Record<number, string>;
}

/**
 * Who acted, in prose.
 *
 * The name can be absent for two different reasons and both are expected:
 * actor_id has no foreign key, so a user who has been deleted leaves entries
 * behind, and from M2 an agent id will not match the "user" table at all. The
 * entry is still shown either way — dropping history because its author is gone
 * would defeat the point of keeping it.
 */
function actorLabel(entry: ActivityEntry): string {
  if (entry.actorType === "agent") return entry.actorName ?? "An agent";
  return entry.actorName ?? "A removed user";
}

/** What happened, in prose. */
function describe(
  entry: ActivityEntry,
  columnNames: Record<number, string>
): string {
  // A column can be deleted while the log entry naming it survives, so every
  // lookup needs a fallback rather than rendering "undefined".
  const column = (id: number) => columnNames[id] ?? "another column";

  switch (entry.action) {
    case "task.created":
      return "created this task";
    case "task.deleted":
      return "deleted this task";
    case "task.moved": {
      if (!entry.before || !entry.after) return "moved this task";
      return entry.before.columnId === entry.after.columnId
        ? `reordered this within ${column(entry.after.columnId)}`
        : `moved this to ${column(entry.after.columnId)}`;
    }
    case "task.updated": {
      if (!entry.before || !entry.after) return "updated this task";
      const renamed = entry.before.title !== entry.after.title;
      const described = entry.before.description !== entry.after.description;
      if (renamed && described) return "renamed this and edited the description";
      if (renamed) return `renamed this to "${entry.after.title}"`;
      if (described) return "edited the description";
      return "updated this task";
    }
    default:
      // `action` is TEXT in Postgres and this union grows every milestone, so a
      // row written by newer code can reach older code. Say something true
      // rather than crashing the dialog.
      return "changed this task";
  }
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31536000],
  ["month", 2592000],
  ["day", 86400],
  ["hour", 3600],
  ["minute", 60],
];

function relativeTime(iso: string, now: number): string {
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 45) return "just now";
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  for (const [unit, size] of UNITS) {
    if (abs >= size) return format.format(Math.round(seconds / size), unit);
  }
  return "just now";
}

export function ActivityFeed({ taskId, columnNames }: ActivityFeedProps) {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Captured once per load so every row in a render measures against the same
  // instant, and so the timestamps do not depend on render timing.
  const [now, setNow] = useState(() => Date.now());

  // Every setState here lands after an await, never synchronously in the effect
  // body — the latter is a lint error and would cascade an extra render. The
  // component is keyed by task id, so `loading` starting true is already correct
  // for a fresh mount and needs no reset on the way in.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchTaskActivity(taskId);
        if (cancelled) return;
        setEntries(data);
        setNow(Date.now());
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load history");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    // Closing the dialog unmounts the feed mid-flight; without this the
    // response would set state on a component that is gone.
    return () => {
      cancelled = true;
    };
  }, [taskId]);

  if (loading && entries.length === 0) {
    return <p className="text-xs text-muted-foreground">Loading history…</p>;
  }
  if (error) {
    return (
      <p role="alert" className="text-xs text-destructive">
        {error}
      </p>
    );
  }
  if (entries.length === 0) {
    return <p className="text-xs text-muted-foreground">No history yet.</p>;
  }

  return (
    <ul className="grid gap-2.5">
      {entries.map((entry) => (
        <li key={entry.id} className="flex items-start gap-2.5">
          <Avatar className="size-6">
            <AvatarImage src={entry.actorImage ?? undefined} alt="" />
            <AvatarFallback className="text-[10px]">
              {actorLabel(entry).slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <p className="text-xs leading-6 text-muted-foreground">
            <span className="font-medium text-foreground">
              {actorLabel(entry)}
            </span>{" "}
            {describe(entry, columnNames)}
            {" · "}
            <time dateTime={entry.createdAt} title={entry.createdAt}>
              {relativeTime(entry.createdAt, now)}
            </time>
          </p>
        </li>
      ))}
    </ul>
  );
}
