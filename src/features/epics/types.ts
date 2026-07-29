/**
 * A larger-than-task grouping a board's work rolls up into (031), one level above
 * a milestone — "Billing", "Onboarding". Board-scoped like a milestone: a second
 * board's "Billing" is a different epic. Unlike a milestone it has no due date of
 * its own — an epic is an open-ended bucket, and the date that matters belongs to
 * the milestones inside it. 089 keeps that: the window an epic reports is derived
 * from its contents, never stored.
 */

/**
 * Where an epic stands (089). A plain field, not a sprint's lifecycle: the
 * transitions are free and any number can be active at once, because a bucket
 * has no timebox to open or close. See 089 for why 'paused' is one of the four.
 */
export type EpicStatus = "proposed" | "active" | "paused" | "done";

export const EPIC_STATUSES: readonly EpicStatus[] = [
  "proposed",
  "active",
  "paused",
  "done",
] as const;

export const EPIC_STATUS_LABELS: Record<EpicStatus, string> = {
  proposed: "Proposed",
  active: "Active",
  paused: "Paused",
  done: "Done",
};

export function isEpicStatus(value: unknown): value is EpicStatus {
  return (
    typeof value === "string" &&
    (EPIC_STATUSES as readonly string[]).includes(value)
  );
}

export interface Epic {
  id: number;
  boardId: number;
  name: string;
  /** 089. Defaults to 'active' — see the migration for why that, not 'proposed'. */
  status: EpicStatus;
  /**
   * The person to ask about this bucket (089), or null. A human only: an agent
   * is pointed at tasks, not left holding a body of work. The id survives a
   * rename; ownerName rides along so a list can paint a face without a join.
   */
  ownerId: string | null;
  /** Resolved at read time, LEFT — a deleted owner leaves a null name, not a gap. */
  ownerName: string | null;
  createdAt: string;
  /**
   * Progress, derived at read time: how many top-level tasks roll up into this
   * epic — directly (task.epic_id) or through a member milestone — and how many
   * of those sit in the board's done column. done ≤ total; both 0 for a fresh
   * epic, and done stays 0 on a board with no done column, the milestone rule.
   */
  total: number;
  done: number;
  /**
   * The window the epic's contents describe (089), 'YYYY-MM-DD' or null —
   * derived, never stored, which is what keeps 031's "an epic has no date of its
   * own" true while still answering "when is Billing happening?". startDate is
   * the earliest start among the epic's tasks; targetDate the latest date it
   * points at, across both its tasks' due dates and its member milestones' —
   * a milestone with a date but no dated tasks still moves the target, which is
   * the ordinary case for a checkpoint that has not been broken down yet.
   * Null when nothing inside carries a date: an undated bucket says so rather
   * than inventing today.
   */
  startDate: string | null;
  targetDate: string | null;
}

export interface CreateEpicInput {
  name: string;
  status?: EpicStatus;
  /** null/absent for unowned. */
  ownerId?: string | null;
}

export interface UpdateEpicInput {
  name?: string;
  status?: EpicStatus;
  /** Three-valued, the milestone rule: undefined leaves the owner, null clears it. */
  ownerId?: string | null;
}
