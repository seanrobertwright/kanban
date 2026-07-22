"use client";

import { useEffect, useMemo, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { fetchRequests } from "../client/api";
import type { RequestItem } from "../types";

interface RequestsDialogProps {
  boardId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Request management (1.8): the intake queue. A self-fetching lens (Timesheet /
 * Forms shape) over the board's request tasks — those born of a form submission
 * — grouped by their status column, each showing its source form, requester, and
 * nearest SLA. It reads what Forms (039) + routing (1.7) + SLAs (1.6) already
 * produce; the queue is the view that ties them into "incoming requests".
 */
export function RequestsDialog({ boardId, open, onOpenChange }: RequestsDialogProps) {
  const [requests, setRequests] = useState<RequestItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        setError(null);
        const list = await fetchRequests(boardId);
        if (!cancelled) setRequests(list);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load requests");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, boardId]);

  // Group by status column, preserving the server's column order.
  const groups = useMemo(() => {
    const byStatus = new Map<string, RequestItem[]>();
    for (const r of requests) {
      const list = byStatus.get(r.status) ?? [];
      list.push(r);
      byStatus.set(r.status, list);
    }
    return [...byStatus.entries()];
  }, [requests]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Requests</DialogTitle>
          <DialogDescription>
            Incoming requests (form submissions), grouped by status with their
            requester and SLA.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        {requests.length === 0 ? (
          <p className="text-sm text-muted-foreground">No requests yet.</p>
        ) : (
          <div className="grid gap-3">
            {groups.map(([status, items]) => (
              <div key={status} className="grid gap-1.5">
                <p className="text-xs font-medium uppercase text-muted-foreground">
                  {status} ({items.length})
                </p>
                <ul className="grid gap-1.5">
                  {items.map((r) => (
                    <li key={r.id} className="grid gap-0.5 rounded-lg border px-3 py-2 text-sm">
                      <p className="truncate font-medium">{r.title}</p>
                      <p className="text-xs text-muted-foreground">
                        via {r.source || "a form"}
                        {r.requesterName && ` · by ${r.requesterName}`}
                        {r.slaDueAt && ` · SLA ${slaLabel(r.slaDueAt)}`}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** A terse "due in 42m" / "overdue" from an ISO due time. */
function slaLabel(dueAtIso: string): string {
  const mins = Math.round((Date.parse(dueAtIso) - Date.now()) / 60000);
  if (mins < 0) return "overdue";
  if (mins < 60) return `due in ${mins}m`;
  return `due in ${Math.round(mins / 60)}h`;
}
