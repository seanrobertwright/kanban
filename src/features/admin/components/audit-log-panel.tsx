"use client";

import { useCallback, useState } from "react";

import { Button } from "@/shared/ui/button";
import * as api from "@/features/workspaces/client/api";
import type { Board, WorkspaceMembership } from "@/features/workspaces/types";
import type { AuditEvent } from "../types";
import { usePanelLoad } from "./use-panel-load";

const PAGE = 25;

/**
 * The audit-log viewer: workspace-wide activity, newest first.
 *
 * Paged by offset rather than infinite-scrolled, because the question this
 * answers is "what happened around then", which is a place you navigate to and
 * back from. The server clamps the page size regardless of what is asked for.
 */
export function AuditLogPanel({
  workspace,
  boards,
}: {
  workspace: WorkspaceMembership;
  boards: Board[];
}) {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (next: number) => {
      try {
        setEvents(await api.fetchAuditLog(workspace.id, PAGE, next));
        setOffset(next);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load the audit log");
      }
    },
    [workspace.id]
  );

  const loadFirstPage = useCallback(() => load(0), [load]);
  usePanelLoad(loadFirstPage);

  const boardName = new Map(boards.map((b) => [b.id, b.name]));

  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Every action taken in this workspace, by people and by agents.
        </p>
        <span className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            className="h-6 px-2 text-xs"
            disabled={offset === 0}
            onClick={() => void load(Math.max(0, offset - PAGE))}
          >
            Newer
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-6 px-2 text-xs"
            disabled={events.length < PAGE}
            onClick={() => void load(offset + PAGE)}
          >
            Older
          </Button>
        </span>
      </div>

      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}

      {events.length === 0 ? (
        <p className="text-xs text-muted-foreground">No audit events on this page.</p>
      ) : (
        <ul className="grid gap-1 text-xs">
          {events.map((event) => (
            <li key={event.id} className="flex items-baseline gap-2">
              <time
                dateTime={event.createdAt}
                className="shrink-0 text-muted-foreground tabular-nums"
              >
                {new Date(event.createdAt).toLocaleString()}
              </time>
              <span className="min-w-0 flex-1 truncate">
                {event.actorName ?? `${event.actorType} ${event.actorId}`} ·{" "}
                {event.action}
                {event.taskId != null && ` · task #${event.taskId}`}
                {event.boardId != null &&
                  ` · ${boardName.get(event.boardId) ?? `board #${event.boardId}`}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
