"use client";

import { useEffect, useState } from "react";

import { PRIORITY_LABELS, PRIORITY_ORDER } from "@/features/tasks/types";
import { formatDueDate } from "@/shared/lib/due-date";
import { relativeTime } from "@/shared/lib/relative-time";
import { Avatar, AvatarFallback, AvatarImage } from "@/shared/ui/avatar";
import { fetchTaskActivity } from "../client/api";
import type { ActivityEntry } from "../types";

interface ActivityFeedProps {
  taskId: number;
  /** Column titles by id, for naming the columns a task moved between. */
  columnNames: Record<number, string>;
  /** Member names by user id, for naming who a task was assigned to. */
  memberNames: Record<string, string>;
  /**
   * Changes to force a refetch. Commenting writes a log row, and the thread that
   * wrote it sits directly above this — without a nudge, the history would keep
   * insisting nothing happened until the dialog is reopened.
   */
  refreshToken?: number;
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
  columnNames: Record<number, string>,
  memberNames: Record<string, string>
): string {
  // A column can be deleted while the log entry naming it survives, so every
  // lookup needs a fallback rather than rendering "undefined".
  const column = (id: number) => columnNames[id] ?? "another column";

  // Same shape of problem, one degree worse: the log outlives the assignment,
  // and being removed from a workspace clears your assignments but not the
  // record of them. So an id here routinely names someone the member list no
  // longer contains — the common case, not the edge case.
  const person = (id: string | null | undefined) =>
    id == null ? "nobody" : (memberNames[id] ?? "a former member");

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
    case "task.assigned": {
      if (!entry.before || !entry.after) return "changed the assignee";
      const from = entry.before.assigneeId;
      const to = entry.after.assigneeId;
      // Self-assignment is worth its own phrasing: "Bob assigned this to Bob"
      // is how a machine talks about the most ordinary thing on a board.
      if (to != null && to === entry.actorId) return "took this on";
      if (to == null) return `unassigned ${person(from)}`;
      if (from == null) return `assigned this to ${person(to)}`;
      return `reassigned this from ${person(from)} to ${person(to)}`;
    }
    case "task.prioritized": {
      if (!entry.before || !entry.after) return "changed the priority";
      const from = entry.before.priority;
      const to = entry.after.priority;
      if (to == null) return "changed the priority";
      if (to === "none") return "cleared the priority";
      const label = PRIORITY_LABELS[to];
      // "raised" and "lowered" rather than "changed", which is what
      // PRIORITY_ORDER's ordering is for. Direction is the whole content of a
      // priority change — a reader scanning a history wants to know something
      // got more urgent, and "changed priority to High" makes them find the
      // previous entry to learn whether that is news.
      //
      // `from` is undefined on rows written before 006, and there is no
      // direction to state without it. That is the one case that falls back.
      if (from == null) return `set the priority to ${label}`;
      if (from === "none") return `set the priority to ${label}`;
      const rose = PRIORITY_ORDER.indexOf(to) > PRIORITY_ORDER.indexOf(from);
      return `${rose ? "raised" : "lowered"} the priority to ${label}`;
    }
    case "task.scheduled": {
      if (!entry.before || !entry.after) return "changed the due date";
      const from = entry.before.dueDate;
      const to = entry.after.dueDate;
      if (to === undefined) return "changed the due date";
      if (to === null) return "cleared the due date";
      const when = formatDueDate(to);
      // Three phrasings, because "set" and "moved" are different events to a
      // reader: the first is a commitment, the second is a commitment slipping
      // or being pulled in. `from` undefined means a pre-006 row, which cannot
      // tell the two apart, so it takes the weaker "set".
      return from == null ? `set the due date to ${when}` : `moved the due date to ${when}`;
    }
    case "task.labeled": {
      if (!entry.before || !entry.after) return "changed the labels";
      const before = entry.before.labels ?? [];
      const after = entry.after.labels ?? [];
      const had = new Set(before.map((l) => l.id));
      const has = new Set(after.map((l) => l.id));
      const added = after.filter((l) => !had.has(l.id));
      const removed = before.filter((l) => !has.has(l.id));

      // The snapshot is a whole set on either side, but a reader wants the
      // delta: "added bug" is the event, where "labels are now bug, p0,
      // regression" makes them diff two lists in their head. The names come from
      // the snapshot rather than the vocabulary, which is what keeps this
      // readable after a label is deleted — often the very entry being read.
      const names = (labels: { name: string }[]) =>
        labels.map((l) => `"${l.name}"`).join(", ");

      if (added.length && removed.length)
        return `added ${names(added)} and removed ${names(removed)}`;
      if (added.length) return `added ${names(added)}`;
      if (removed.length) return `removed ${names(removed)}`;
      return "changed the labels";
    }
    case "task.claimed":
      // Who took it is the actor, named in bold beside this line already, so the
      // phrasing does not repeat it. "started working" rather than "claimed" reads
      // as the event it stands for — a claim is the working hold, not paperwork.
      return "started working on this";
    case "task.released": {
      const held = entry.before?.claimedBy;
      // Actor and holder usually coincide — someone dropping their own hold — and
      // then it is simply "stopped working". They diverge in the one case worth
      // its own phrasing: an admin breaking a hold a crashed agent left stuck,
      // which is why the holder is recorded in the snapshot (see task.claimed).
      if (!held) return "released this";
      if (held.type === entry.actorType && held.id === entry.actorId)
        return "stopped working on this";
      if (held.type === "agent") return "released an agent's claim";
      return `released ${person(held.id)}'s claim`;
    }
    // The comment itself is not repeated here. It is rendered in full a few
    // inches away in the thread, and the log's job is to say a thing happened,
    // not to become a second copy of it that can drift from the first.
    case "comment.created":
      return "commented";
    case "comment.updated":
      return "edited a comment";
    case "comment.deleted": {
      const author = entry.before?.author;
      if (!author) return "deleted a comment";
      // Worth distinguishing, because this is the one entry where the actor and
      // the subject routinely differ: an admin may delete anyone's remark, and
      // "deleted a comment" would hide whose. This is what CommentSnapshot
      // records the author for.
      if (author.type === "human" && author.id === entry.actorId)
        return "deleted their comment";
      if (author.type === "agent") return "deleted an agent's comment";
      return `deleted ${person(author.id)}'s comment`;
    }
    default:
      // `action` is TEXT in Postgres and this union grows every milestone, so a
      // row written by newer code can reach older code. Say something true
      // rather than crashing the dialog — and say "this", not "this task",
      // since from 005 an entry is not necessarily about the task itself.
      return "changed this";
  }
}

export function ActivityFeed({
  taskId,
  columnNames,
  memberNames,
  refreshToken = 0,
}: ActivityFeedProps) {
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
  }, [taskId, refreshToken]);

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
            {describe(entry, columnNames, memberNames)}
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
