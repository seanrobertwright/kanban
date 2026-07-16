import type { LabelRef } from "@/features/labels/types";

/**
 * Mirrors the `task_priority` enum in 006, in declaration order — which is also
 * sort order, in Postgres and in PRIORITY_ORDER below. Keep the two in step: a
 * value added here without an ALTER TYPE is a write that fails at the database,
 * and one added there without this is a value the UI cannot name.
 *
 * A closed set, unlike ActivityAction: growing it is a product decision, not a
 * milestone's side effect. See the reasoning in 006.
 */
export type TaskPriority = "none" | "low" | "medium" | "high" | "urgent";

/**
 * Lowest to highest, matching the enum's declaration order — so an index into
 * this array compares two priorities, which is what lets the activity feed say
 * "raised" or "lowered" rather than the much less useful "changed".
 */
export const PRIORITY_ORDER: readonly TaskPriority[] = [
  "none",
  "low",
  "medium",
  "high",
  "urgent",
] as const;

export const PRIORITY_LABELS: Record<TaskPriority, string> = {
  none: "No priority",
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};

export function isTaskPriority(value: unknown): value is TaskPriority {
  return (
    typeof value === "string" &&
    (PRIORITY_ORDER as readonly string[]).includes(value)
  );
}

export interface Task {
  id: number;
  columnId: number;
  title: string;
  description: string;
  position: number;
  /**
   * The member this task is assigned to, or null. Peer to the `agentId` that
   * lands at M2 (PRD §8) — the picker treats agents as another kind of
   * assignee rather than a separate concept, which is the wedge in one field.
   *
   * Only the id: the name and avatar are resolved client-side from the member
   * list the assignee picker already needs, rather than joined onto every task
   * in getBoard. Widening the read to carry display data would put the same
   * two strings on every card of the same person.
   */
  assigneeId: string | null;
  /**
   * Never null: 006 gives the column NOT NULL DEFAULT 'none', because "nobody
   * has triaged this" is a state worth naming rather than an absence. That is
   * what keeps updates two-valued — see UpdateTaskInput.
   */
  priority: TaskPriority;
  /**
   * A calendar date as 'YYYY-MM-DD', or null for no due date.
   *
   * A string rather than a Date, deliberately and all the way down: 006 stores
   * DATE, and shared/db/client.ts stops node-postgres turning it into a local
   * midnight that serializes to the wrong day east of Greenwich. Nothing should
   * pass this through `new Date()` — the format sorts and compares
   * lexicographically, which covers every question the UI actually asks of it.
   */
  dueDate: string | null;
  /**
   * The labels this task wears — id and name, never null, `[]` when unlabelled.
   *
   * Names rather than bare ids, unlike assigneeId: the reasoning is LabelRef's,
   * and it comes from what the log needs rather than what the card wants. The
   * colour is still a client-side lookup against the workspace vocabulary, which
   * the picker holds anyway.
   */
  labels: LabelRef[];
  createdAt: string;
}

export interface CreateTaskInput {
  columnId: number;
  title: string;
  description?: string;
  assigneeId?: string | null;
  priority?: TaskPriority;
  dueDate?: string | null;
  /** Ids, not refs: the caller says which labels, the database knows their names. */
  labelIds?: number[];
}

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  /**
   * Three-valued, and the distinction is load-bearing: `undefined` means "leave
   * the assignee alone", `null` means "unassign". The existing COALESCE idiom in
   * updateTask cannot express this — it reads null as "no value supplied" — so
   * the repository tests for the key's presence instead. Harmless for title and
   * description, neither of which is nullable; fatal here, where clearing the
   * field IS one of the two things a user wants to do.
   */
  assigneeId?: string | null;
  /**
   * Two-valued, and the contrast with the two fields either side of it is the
   * point. Clearing a priority means setting it to 'none' — a value — so `null`
   * never has to mean "clear", which frees it to mean "not supplied" and lets
   * COALESCE do the work, exactly as it does for title.
   *
   * The rule this and dueDate together establish: a field needs the
   * supplied-flag treatment iff it has no non-null value meaning "empty".
   * Priority has one, so it does not.
   */
  priority?: TaskPriority;
  /**
   * Three-valued, like assigneeId and for the identical reason: there is no date
   * that means "no due date", so `null` is the cleared state and cannot also be
   * the absent one. `undefined` leaves the date alone; `null` clears it.
   */
  dueDate?: string | null;
  /**
   * Two-valued, and 006's rule is what says so without having to think about it:
   * a set has a non-null value meaning empty — `[]` — so `null` never needs to
   * mean "clear", and no supplied-flag is required. `undefined` leaves the labels
   * alone; `[]` removes them all.
   *
   * The whole set, not a delta. The dialog submits a form rather than a stream of
   * add/remove events, and a set is what lets the log carry a snapshot on either
   * side — which is what undo restores, and what keeps two people editing the
   * same task from replaying each other's adds.
   */
  labelIds?: number[];
}

export interface MoveTaskInput {
  columnId: number;
  position: number;
}
