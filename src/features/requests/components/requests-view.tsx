"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Inbox, RotateCcw, X } from "lucide-react";

import type { Actor } from "@/features/activity/types";
import type { AgentSummary } from "@/features/agents/types";
import type { Column } from "@/features/board/types";
import { PRIORITY_ORDER, type TaskPriority } from "@/features/tasks/types";
import type { Member } from "@/features/workspaces/types";
import { Button } from "@/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { EmptyState } from "@/shared/ui/empty-state";
import { Input } from "@/shared/ui/input";
import { cn } from "@/shared/lib/utils";
import { fetchRequests, triageRequest } from "../client/api";
import { TRIAGE_REASON_MAX, type RequestItem, type TriageRequestInput } from "../types";

/**
 * The Requests lens (1.8, SPEC §1.8): the intake queue as a board view rather
 * than a dialog, because triage is work, and work does not belong in a modal
 * you close to see the board underneath.
 *
 * It fetches its own rows instead of filtering the board's tasks, and that is
 * deliberate: a request's defining facts — which form it came through, who filed
 * it, which SLA is running — live beside the task, not on it, and none of them
 * ride the board payload. The 052 dialog established the fetch; this keeps it.
 *
 * Three groups, in the order an intake team works them: Open (no verdict yet),
 * then what was accepted, then what was declined. Accepting routes the request —
 * into a column, optionally to an owner at a priority — and declining answers it
 * with a reason. Both are reversible: Reopen returns a request to Open, so a
 * mis-triage costs a click rather than a DB edit.
 */

interface RequestsViewProps {
  boardId: number;
  columns: Column[];
  membersById: Record<string, Member>;
  agentsById: Record<string, AgentSummary>;
  /** Member or better. A viewer reads the queue and triages nothing. */
  canEdit: boolean;
  /** Open the task dialog for a request — the board owns the task itself. */
  onOpenRequest: (taskId: number, columnId: number) => void;
}

type Group = { key: "open" | "accepted" | "declined"; title: string; items: RequestItem[] };

export function RequestsView({
  boardId,
  columns,
  membersById,
  agentsById,
  canEdit,
  onOpenRequest,
}: RequestsViewProps) {
  const [requests, setRequests] = useState<RequestItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  /** The request whose decline reason is being typed, if any. */
  const [declining, setDeclining] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setError(null);
        const list = await fetchRequests(boardId);
        if (!cancelled) setRequests(list);
      } catch (e) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "Could not load requests");
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [boardId]);

  const groups = useMemo<Group[]>(() => {
    const state = (r: RequestItem) => r.triage?.state ?? "open";
    return [
      { key: "open" as const, title: "Open" },
      { key: "accepted" as const, title: "Accepted" },
      { key: "declined" as const, title: "Declined" },
    ].map((g) => ({ ...g, items: requests.filter((r) => state(r) === g.key) }));
  }, [requests]);

  async function triage(request: RequestItem, input: TriageRequestInput) {
    // No optimistic write: a verdict is one round trip and its result carries
    // the moved column and the new assignee, which the client would otherwise
    // have to guess at. Replace the row with what the server says it is.
    try {
      setError(null);
      const updated = await triageRequest(boardId, request.id, input);
      setRequests((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
      setDeclining(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not triage that request");
    }
  }

  if (loaded && requests.length === 0) {
    return (
      <>
        {error && <ErrorLine message={error} />}
        <EmptyState
          icon={Inbox}
          title="No requests yet"
          hint="Requests arrive as form submissions. Share a form to start intake."
        />
      </>
    );
  }

  return (
    <div className="grid gap-6">
      {error && <ErrorLine message={error} />}
      {groups.map((group) => (
        <section key={group.key} className="grid gap-2">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {group.title} ({group.items.length})
          </h2>
          {group.items.length === 0 ? (
            <p className="rounded-xl border border-dashed px-3 py-4 text-xs text-muted-foreground">
              {group.key === "open"
                ? "Nothing waiting on triage."
                : `Nothing ${group.key}.`}
            </p>
          ) : (
            <ul className="grid gap-2">
              {group.items.map((request) => (
                <RequestRow
                  key={request.id}
                  request={request}
                  columns={columns}
                  membersById={membersById}
                  agentsById={agentsById}
                  canEdit={canEdit}
                  declining={declining === request.id}
                  onDecline={() => setDeclining(request.id)}
                  onCancelDecline={() => setDeclining(null)}
                  onTriage={(input) => triage(request, input)}
                  onOpen={() => onOpenRequest(request.id, request.columnId)}
                />
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

function ErrorLine({ message }: { message: string }) {
  return (
    <p role="alert" className="text-sm text-destructive">
      {message}
    </p>
  );
}

function RequestRow({
  request,
  columns,
  membersById,
  agentsById,
  canEdit,
  declining,
  onDecline,
  onCancelDecline,
  onTriage,
  onOpen,
}: {
  request: RequestItem;
  columns: Column[];
  membersById: Record<string, Member>;
  agentsById: Record<string, AgentSummary>;
  canEdit: boolean;
  declining: boolean;
  onDecline: () => void;
  onCancelDecline: () => void;
  onTriage: (input: TriageRequestInput) => void;
  onOpen: () => void;
}) {
  const [reason, setReason] = useState("");
  /**
   * The routing chosen but not yet committed. Staged rather than applied
   * per-menu because assigning a request is not a verdict on it: a triager who
   * picks an owner and then declines must not have accepted it by accident. One
   * Accept press writes the column, the owner and the priority together.
   */
  const [pending, setPending] = useState<{
    columnId?: number;
    assignee?: Actor;
    priority?: TaskPriority;
  }>({});
  const open = request.triage === null;
  /** A person or an agent by id, through whichever map owns them. */
  const nameOf = (actor: Actor) =>
    actor.type === "agent"
      ? agentsById[actor.id]?.name
      : membersById[actor.id]?.name;
  const assigneeName = request.assignee ? nameOf(request.assignee) : null;
  const pendingAssigneeName = pending.assignee ? nameOf(pending.assignee) : null;

  return (
    <li className="grid gap-2 rounded-xl border px-3 py-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <button
          type="button"
          onClick={onOpen}
          className="truncate text-left text-sm font-medium hover:underline"
        >
          {request.title}
        </button>
        <span className="shrink-0 text-xs text-muted-foreground">
          {request.status}
          {request.priority !== "none" && ` · ${request.priority}`}
          {assigneeName && ` · ${assigneeName}`}
        </span>
      </div>

      <p className="text-xs text-muted-foreground">
        via {request.source || "a form"}
        {request.requesterName && ` · by ${request.requesterName}`}
        {request.slaBreachedAt ? (
          <span className="text-destructive"> · SLA breached</span>
        ) : (
          request.slaDueAt && ` · SLA ${slaLabel(request.slaDueAt)}`
        )}
        {request.triage?.reason && ` · "${request.triage.reason}"`}
      </p>

      {canEdit && open && !declining && (
        <div className="flex flex-wrap items-center gap-1.5">
          <Menu
            label={
              pending.columnId
                ? `Into ${columns.find((c) => c.id === pending.columnId)?.title ?? "column"}`
                : "Into…"
            }
          >
            {/* Grouped because DropdownMenuLabel is Base UI's Menu.GroupLabel:
                outside a Group it throws and takes the view down with it. */}
            <DropdownMenuGroup>
              <DropdownMenuLabel>Accept into</DropdownMenuLabel>
              {columns.map((column) => (
                <DropdownMenuItem
                  key={column.id}
                  onClick={() => setPending((p) => ({ ...p, columnId: column.id }))}
                >
                  {column.title}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() =>
                setPending((p) => {
                  const next = { ...p };
                  delete next.columnId;
                  return next;
                })
              }
            >
              Leave in {request.status}
            </DropdownMenuItem>
          </Menu>

          <Menu label={pendingAssigneeName ?? "Assign"}>
            <DropdownMenuGroup>
              <DropdownMenuLabel>People</DropdownMenuLabel>
              {Object.values(membersById).map((member) => (
                <DropdownMenuItem
                  key={member.userId}
                  onClick={() =>
                    setPending((p) => ({
                      ...p,
                      assignee: { type: "human", id: member.userId },
                    }))
                  }
                >
                  {member.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
            {Object.values(agentsById).length > 0 && (
              <DropdownMenuGroup>
                <DropdownMenuLabel>Agents</DropdownMenuLabel>
                {Object.values(agentsById).map((agent) => (
                  <DropdownMenuItem
                    key={agent.id}
                    onClick={() =>
                      setPending((p) => ({
                        ...p,
                        assignee: { type: "agent", id: agent.id },
                      }))
                    }
                  >
                    {agent.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            )}
          </Menu>

          <Menu label={pending.priority ?? "Priority"}>
            {[...PRIORITY_ORDER].reverse().map((priority: TaskPriority) => (
              <DropdownMenuItem
                key={priority}
                onClick={() => setPending((p) => ({ ...p, priority }))}
              >
                {priority}
              </DropdownMenuItem>
            ))}
          </Menu>

          <Button size="sm" onClick={() => onTriage({ action: "accept", ...pending })}>
            <Check /> Accept
          </Button>
          <Button size="sm" variant="ghost" onClick={onDecline}>
            <X /> Decline
          </Button>
        </div>
      )}

      {canEdit && open && declining && (
        <form
          className="flex flex-wrap items-center gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            onTriage({ action: "decline", reason: reason.trim() });
          }}
        >
          <Input
            autoFocus
            value={reason}
            maxLength={TRIAGE_REASON_MAX}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Why is this declined?"
            className="h-8 max-w-xs"
            aria-label="Reason for declining"
          />
          <Button size="sm" type="submit">
            Decline
          </Button>
          <Button size="sm" variant="ghost" type="button" onClick={onCancelDecline}>
            Cancel
          </Button>
        </form>
      )}

      {canEdit && !open && (
        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              "text-xs font-medium",
              request.triage?.state === "accepted"
                ? "text-muted-foreground"
                : "text-destructive"
            )}
          >
            {request.triage?.state === "accepted" ? "Accepted" : "Declined"}
          </span>
          <Button size="sm" variant="ghost" onClick={() => onTriage({ action: "reopen" })}>
            <RotateCcw /> Reopen
          </Button>
        </div>
      )}
    </li>
  );
}

function Menu({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button size="sm" variant="outline">
            {label}
          </Button>
        }
      />
      <DropdownMenuContent align="start">{children}</DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A terse "due in 42m" / "overdue" from an ISO due time. */
function slaLabel(dueAtIso: string): string {
  const mins = Math.round((Date.parse(dueAtIso) - Date.now()) / 60000);
  if (mins < 0) return "overdue";
  if (mins < 60) return `due in ${mins}m`;
  return `due in ${Math.round(mins / 60)}h`;
}
