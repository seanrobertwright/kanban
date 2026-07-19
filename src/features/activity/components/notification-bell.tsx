"use client";

import { useEffect, useState } from "react";
import { Bell } from "lucide-react";

import { relativeTime } from "@/shared/lib/relative-time";
import { Avatar, AvatarFallback, AvatarImage } from "@/shared/ui/avatar";
import { Button } from "@/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import * as api from "../client/api";
import type { NotificationEntry, WorkspaceNotifications } from "../types";

/** The activity log is looser than the union (003), so an unknown action still
 *  reads as a sentence rather than crashing — default to "updated". */
const ACTION_VERB: Record<string, string> = {
  "task.created": "created",
  "task.updated": "updated",
  "task.moved": "moved",
  "task.deleted": "deleted",
  "task.assigned": "reassigned",
  "task.prioritized": "reprioritized",
  "task.scheduled": "rescheduled",
  "task.claimed": "claimed",
  "task.released": "released",
  "task.labeled": "relabeled",
  "comment.created": "commented on",
  "comment.updated": "edited a comment on",
  "comment.deleted": "deleted a comment on",
  "comment.resolved": "resolved a comment on",
  "comment.reopened": "reopened a comment on",
  "column.created": "added a column",
  "column.updated": "renamed a column",
  "column.moved": "reordered a column",
  "column.deleted": "removed a column",
  "label.created": "added a label",
  "label.updated": "edited a label",
  "label.deleted": "deleted a label",
  "milestone.created": "added a milestone",
  "milestone.updated": "edited a milestone",
  "milestone.deleted": "deleted a milestone",
  "time.logged": "logged time on",
  "time.deleted": "removed a time entry on",
};

const POLL_MS = 60_000;

function actorLabel(entry: NotificationEntry): string {
  if (entry.actorName) return entry.actorName;
  return entry.actorType === "agent" ? "An agent" : "Someone";
}

function NotificationRow({
  entry,
  unread,
  now,
}: {
  entry: NotificationEntry;
  unread: boolean;
  now: number;
}) {
  // A comment that names the reader outranks its generic verb: "mentioned you
  // on" is the sentence worth interrupting someone for (024).
  const verb = entry.mentionedMe
    ? "mentioned you on"
    : (ACTION_VERB[entry.action] ?? "updated");
  return (
    <div
      className={`flex gap-2 rounded-md px-2 py-1.5 text-sm ${unread ? "bg-primary/5" : ""}`}
    >
      <Avatar className="mt-0.5 size-5 shrink-0" aria-hidden="true">
        <AvatarImage src={entry.actorImage ?? undefined} alt="" />
        <AvatarFallback className="text-[9px]">
          {actorLabel(entry).slice(0, 2).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <p className="leading-snug">
          <span className="font-medium">{actorLabel(entry)}</span> {verb}
          {entry.taskTitle ? (
            <span className="text-muted-foreground"> “{entry.taskTitle}”</span>
          ) : null}
        </p>
        <p className="text-xs text-muted-foreground">
          {relativeTime(entry.createdAt, now)}
        </p>
      </div>
    </div>
  );
}

export function NotificationBell({ workspaceId }: { workspaceId: string }) {
  const [data, setData] = useState<WorkspaceNotifications | null>(null);
  // The reference time relative times are measured against. State, not
  // Date.now() in render (which is impure) — set after each fetch, so "2m ago"
  // is stable between polls and updates when fresh data arrives.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let active = true;
    // Defined inside the effect so every setState below lands after an await,
    // never synchronously in the effect body.
    async function load() {
      try {
        const next = await api.fetchNotifications(workspaceId);
        if (!active) return;
        setData(next);
        setNow(Date.now());
      } catch {
        // A failed poll is not worth surfacing — the next one may succeed.
      }
    }
    void load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [workspaceId]);

  function onOpenChange(open: boolean) {
    // Opening the bell is reading it: clear the badge and move the server-side
    // marker. The list keeps its unread shading for this viewing (it is keyed to
    // the last-seen we fetched with, which we deliberately do not touch here) —
    // the next poll brings the advanced marker and the shading fades.
    if (open && data && data.unreadCount > 0) {
      setData({ ...data, unreadCount: 0 });
      void api.markNotificationsSeen(workspaceId).catch(() => {});
    }
  }

  const unreadCount = data?.unreadCount ?? 0;
  const items = data?.items ?? [];
  const lastSeen = data?.lastSeenAt ?? null;

  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="relative"
            aria-label={
              unreadCount > 0
                ? `Notifications, ${unreadCount} unread`
                : "Notifications"
            }
          >
            <Bell />
            {unreadCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium tabular-nums text-primary-foreground">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            )}
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-80 p-1">
        <p className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
          Activity
        </p>
        {items.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground">
            Nothing yet.
          </p>
        ) : (
          <div className="max-h-96 overflow-y-auto">
            {items.map((entry) => (
              <NotificationRow
                key={entry.id}
                entry={entry}
                unread={lastSeen == null || entry.createdAt > lastSeen}
                now={now}
              />
            ))}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
