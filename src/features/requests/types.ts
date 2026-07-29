import type { Actor } from "@/features/activity/types";
import type { TaskPriority } from "@/features/tasks/types";

/**
 * Request management (052, rock 1.8). A request is a Form (039) submission — a
 * task carrying request_meta. The Requests lens (086) lists them with their
 * status (column), the form they came through, who filed them, and their nearest
 * open SLA due time, so an intake team works the backlog of incoming work — and
 * triages it: accept a request into a working column (optionally assigning it
 * and setting its priority), or decline it with a reason.
 */
export interface RequestItem {
  id: number;
  title: string;
  /** The task's column — its request status. */
  status: string;
  columnId: number;
  /** The form the request came through. */
  source: string;
  requesterName: string | null;
  /** The nearest open SLA due time, or null if untimed. */
  slaDueAt: string | null;
  /** When an SLA on this request breached, or null while all of them hold. */
  slaBreachedAt: string | null;
  priority: TaskPriority;
  /**
   * Who owns the request — a person or an agent — or null while nobody does.
   * The Task shape's Actor, not a bare id, so the lens resolves a name through
   * the same two maps every card does.
   */
  assignee: Actor | null;
  /** The triage verdict, or null while the request is still open. */
  triage: RequestTriage | null;
  createdAt: string;
}

/**
 * What triage recorded. Stored inside `request_meta.triage`, so it travels with
 * the stamp that made the task a request in the first place.
 */
export interface RequestTriage {
  state: "accepted" | "declined";
  /** ISO timestamp of the verdict. */
  at: string;
  actorType: string;
  actorId: string;
  /** Why it was declined. Only ever set on a decline. */
  reason?: string;
}

export const TRIAGE_REASON_MAX = 280;

/**
 * A triage verdict, as the client sends it.
 *
 * `accept` may carry the routing decisions triage exists to make — which column
 * the work belongs in, who owns it, how urgent it is — and each is optional,
 * because "yes, this is real work" is itself a complete verdict. `decline`
 * carries a reason instead: a declined request is answered, not deleted, so the
 * requester can be told why.
 *
 * `reopen` clears the verdict and returns the request to the open queue — the
 * escape hatch from a mis-triage, which without it would need a DB edit.
 */
export type TriageRequestInput =
  | {
      action: "accept";
      columnId?: number;
      assignee?: Actor | null;
      priority?: TaskPriority;
    }
  | { action: "decline"; reason?: string }
  | { action: "reopen" };
