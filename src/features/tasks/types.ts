import type { Actor } from "@/features/activity/types";
import type { CustomFieldValue } from "@/features/custom-fields/types";
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

/**
 * Mirrors the `task_type` enum in 022 — what kind of work a task records.
 * A closed set like TaskPriority and for its reason: growing the taxonomy is a
 * product decision, not a milestone's side effect. Order carries no meaning;
 * the array exists to enumerate the picker and validate the API.
 */
export type TaskType = "task" | "bug" | "story";

export const TASK_TYPES: readonly TaskType[] = ["task", "bug", "story"] as const;

export const TASK_TYPE_LABELS: Record<TaskType, string> = {
  task: "Task",
  bug: "Bug",
  story: "Story",
};

export function isTaskType(value: unknown): value is TaskType {
  return (
    typeof value === "string" && (TASK_TYPES as readonly string[]).includes(value)
  );
}

/**
 * Mirrors the `recurrence_frequency` enum in 020. A closed set — the cadences a
 * task can repeat on. Order carries no meaning here (nothing sorts by it), unlike
 * TaskPriority; the array exists to enumerate the picker and validate the API.
 */
export type RecurrenceFrequency = "daily" | "weekly" | "monthly";

export const RECURRENCE_FREQUENCIES: readonly RecurrenceFrequency[] = [
  "daily",
  "weekly",
  "monthly",
] as const;

export const RECURRENCE_LABELS: Record<RecurrenceFrequency, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
};

export function isRecurrenceFrequency(
  value: unknown
): value is RecurrenceFrequency {
  return (
    typeof value === "string" &&
    (RECURRENCE_FREQUENCIES as readonly string[]).includes(value)
  );
}

export interface Task {
  id: number;
  columnId: number;
  title: string;
  description: string;
  /**
   * This task's order among the tasks it renders beside — its column's other
   * top-level tasks, or its parent's other pieces in the same column. See 008:
   * the scope is (columnId, parentId), and for a top-level task that is exactly
   * what position has always meant.
   */
  position: number;
  /**
   * The task this one decomposes, or null if it is top-level.
   *
   * Immutable — 008 enforces that with a trigger, because the depth-1 invariant
   * is race-free only while this cannot change. Hence its absence from
   * UpdateTaskInput, which is a design decision rather than an omission.
   *
   * A subtask is a whole task: it has its own status, assignee, priority, due
   * date, labels and comments, and at M2 an agent claims and works one exactly as
   * it would any other. What it does not have is a place on the board, which
   * renders top-level tasks only — the pieces live in the parent.
   */
  parentId: number | null;
  /**
   * How many subtasks this task has. Always 0 for a subtask, since depth is 1.
   *
   * Derived rather than stored, and absent from TaskSnapshot for the same reason:
   * it is a fact about other rows, not state this task holds. Undo restores what
   * a task *was*, and a count is not that — recreating a deleted parent restores
   * its pieces, which restores the count on its own.
   *
   * The card needs it and nothing else does, which is why the pieces themselves
   * are fetched only when a dialog opens (the shape comments already use). A
   * count is one integer per card; the subtasks are a second board's worth of
   * rows nobody is looking at.
   */
  subtaskCount: number;
  /**
   * How many tasks this one is blocked by — the count of its dependency edges
   * (018). Derived like subtaskCount, and absent from TaskSnapshot for its
   * reason: a dependency is a relationship between two tasks, not state this one
   * holds, so undo has no use for it and the migration keeps it out of the log
   * entirely. 0 when the task waits on nothing.
   *
   * The count only — never "blocked" vs "unblocked", which would need to know a
   * blocker is finished, and "finished" needs a done-state the board does not
   * have (columns are user-defined). The card shows the relationship exists; a
   * done-aware badge is a deliberate follow-up. The blockers themselves are
   * fetched only when the dialog opens, exactly as subtasks and checklist items.
   */
  blockedByCount: number;
  /**
   * How many blockers are still *open* — not yet in their board's done column
   * (020). The "blocked vs unblocked" the dependency card deferred: when this is
   * > 0 the task is genuinely blocked by unfinished work; when it is 0 the
   * blockers (if any) are all done, or the board has no done column to judge by.
   * Always ≤ blockedByCount. Derived, and absent from TaskSnapshot for its reason.
   */
  blockedByOpenCount: number;
  /**
   * The cadence this task repeats on (020), or null if it does not recur.
   *
   * The live occurrence carries the rule; completing it (moving it into the
   * board's done column) spawns the successor and hands the rule across, so at
   * most one occurrence is recurring at a time. Derived from task_recurrence and
   * absent from TaskSnapshot for 018's reason: it is configuration, not a field
   * undo reconstructs — the spawn logs a plain task.created instead.
   */
  recurrence: RecurrenceFrequency | null;
  /**
   * How many files are attached (021). Derived like subtaskCount and absent from
   * TaskSnapshot for its reason — a count of other rows is not state this task
   * holds. 0 when nothing is attached; the files themselves are fetched only when
   * the dialog opens, exactly as subtasks and checklist items are.
   */
  attachmentCount: number;
  /**
   * Checklist progress — {total, done} — for the card's "2/5" badge (017).
   *
   * Derived, not stored, and absent from TaskSnapshot for subtaskCount's reason:
   * it is a fact about other rows, not state this task holds, so undo has no use
   * for it. Always {total:0, done:0} when the task has no checklist. The items
   * themselves are fetched only when a dialog opens, exactly as the subtasks and
   * comments are — a count is two integers per card; the items are a list nobody
   * is looking at until they open the task.
   */
  checklist: { total: number; done: number };
  /**
   * Who this task is assigned to — a person or an agent (011) — or null. An
   * Actor (type + id), unified above the two peer columns assignee_id / agent_id,
   * the wedge in one field: §8's "assignee_id and agent_id are peers, exactly one
   * set", and §4.3's board that "counts human and agent capacity as peers". This
   * was `assigneeId: string` through M1; 011 gave it the agent half and the Actor
   * shape, matching 010's claimedBy — the picker treats an agent as another kind
   * of assignee rather than a separate concept.
   *
   * Only the principal, not its name: display data is resolved client-side, a
   * human from the member list and an agent from the workspace's agent roster,
   * both of which the picker holds anyway. Joining names onto every task in
   * getBoard would put the same two strings on every card of the same assignee.
   */
  assignee: Actor | null;
  /**
   * Never null: 006 gives the column NOT NULL DEFAULT 'none', because "nobody
   * has triaged this" is a state worth naming rather than an absence. That is
   * what keeps updates two-valued — see UpdateTaskInput.
   */
  priority: TaskPriority;
  /**
   * What kind of work this is (022). Never null — 'task' is the default kind,
   * priority's shape exactly, and what keeps updates two-valued.
   */
  type: TaskType;
  /**
   * Relative effort in points (022), or null for unestimated. Nullable because
   * no number means "unestimated" — 0 is an estimate ("free") — so this is
   * dueDate's three-valued shape on update, not priority's.
   */
  estimate: number | null;
  /**
   * The milestone this task aims at (026), or null. An id, not a ref — the
   * board holds the milestone list (names, dates, progress) the way the
   * picker holds the label vocabulary; joining the name onto every task would
   * copy one string onto every card aiming at it.
   */
  milestoneId: number | null;
  /**
   * The sprint this task is scheduled into (028), or null (the backlog). An id
   * like milestoneId, and for its reason — the board holds the sprint list.
   */
  sprintId: number | null;
  /**
   * The epic this task is filed under (031), or null. An id like milestoneId,
   * and for its reason — the board holds the epic list. A task can be filed on
   * an epic directly, independent of any milestone.
   */
  epicId: number | null;
  /**
   * Relative business value on a 0–10 scale (034), or null for unscored. Bounded
   * so a score is comparable; feeds priorityScore's numerator.
   */
  value: number | null;
  /**
   * Relative risk / uncertainty, 0–10 (034), or null. Feeds priorityScore's
   * denominator — higher risk discounts the score.
   */
  risk: number | null;
  /**
   * The derived prioritisation score (034): value / (estimate × (1 + risk/10)),
   * or null until both value and a non-zero estimate exist. Read-only — computed
   * in taskColumns from the three inputs, never written, never in a snapshot.
   */
  priorityScore: number | null;
  /**
   * When work begins, 'YYYY-MM-DD', or null for no start date (032). dueDate's
   * string-not-Date discipline exactly — it pairs with dueDate to draw a task's
   * bar on the Timeline, where a lone date is only a point.
   */
  startDate: string | null;
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
  /**
   * This task's answers to the board's custom fields (035 → 036 follow-up), the
   * ones it actually has — `[]` when unanswered. Each is a bare {fieldId, value};
   * the name, type and options are on the board (BoardData.customFields), so a
   * card resolves the definition the way it resolves a label's colour.
   *
   * Derived like labels — a subquery in taskColumns — but, unlike labels, absent
   * from TaskSnapshot: 035 deliberately kept custom-field values out of the undo
   * machinery (the fixed-shape snapshot problem), so surfacing them on the card
   * here does not draw them into a diff undo would try to restore. The card reads
   * them; the value edit path (setTaskFieldValues) still writes no log row.
   */
  customFields: CustomFieldValue[];
  /**
   * Who holds the exclusive working claim (010), or null if the task is free.
   *
   * An Actor (type + id), not a bare id like assigneeId, because a claim's
   * holder is polymorphic — a human or an agent — and the type is what says
   * which. This is the wedge made visible: a card can show that an *agent* is
   * actively working a task, the peer to an assignee that §4.3 calls for.
   *
   * Resolved server-side from claimed_by + claimed_by_type into one object, so a
   * reader never has to reassemble it — see taskColumns. Name and avatar are
   * still resolved by the reader (assigneeId's rule), though only humans are in
   * a client-side list today; an agent renders as a generic "claimed" mark until
   * an agent roster lands with the rest of M2.
   */
  claimedBy: Actor | null;
  /**
   * When the current claim was taken, ISO-8601, or null if unclaimed. Present on
   * the task but absent from TaskSnapshot: it lets a reader (or an agent) see how
   * long a hold has sat — a stale-lock signal — but undo has no use for the exact
   * instant, so a snapshot does not carry it. See TaskSnapshot.claimedBy.
   */
  claimedAt: string | null;
  createdAt: string;
}

export interface CreateTaskInput {
  columnId: number;
  title: string;
  description?: string;
  /**
   * Who to assign — a person or an agent (011) — or null/absent for no one. An
   * Actor, so one field carries both, and the repository proves the principal
   * belongs to this workspace before writing it to whichever of the two peer
   * columns its type names.
   */
  assignee?: Actor | null;
  priority?: TaskPriority;
  /** What kind of work this is; absent means 'task', the default kind (022). */
  type?: TaskType;
  /** Points, or null/absent for unestimated (022). */
  estimate?: number | null;
  /** The milestone to aim at (026), or null/absent for none. */
  milestoneId?: number | null;
  /** The sprint to schedule into (028), or null/absent for the backlog. */
  sprintId?: number | null;
  /** The epic to file under (031), or null/absent for none. */
  epicId?: number | null;
  /** Business value 0–10 (034), or null/absent for unscored. */
  value?: number | null;
  /** Risk 0–10 (034), or null/absent. */
  risk?: number | null;
  /** When work begins (032), or null/absent for no start date. dueDate's shape. */
  startDate?: string | null;
  dueDate?: string | null;
  /** Ids, not refs: the caller says which labels, the database knows their names. */
  labelIds?: number[];
  /**
   * How often this task recurs, or null/absent for a one-off. A task can be born
   * recurring, so createTask writes the rule with it; the on-complete spawn then
   * carries it to each successor (020).
   */
  recurrence?: RecurrenceFrequency | null;
  /**
   * The task this one decomposes. Absent means top-level — the only two states
   * there are, so this is two-valued and needs no supplied-flag. 006's rule does
   * not even have to be consulted: a field that cannot be updated cannot have an
   * update semantics problem.
   *
   * The only place a parent is ever set. 008 makes it immutable, so a task is
   * born a piece of something or is never one.
   */
  parentId?: number;
}

/**
 * Conspicuously without `parentId`, and that is the design.
 *
 * 008 makes the column immutable and enforces it with a trigger, because the
 * depth-1 check reads the parent's own parent without a lock — which is only
 * sound while that value cannot change. Adding a field here would compile, and
 * fail at the database, which is the intended outcome: re-parenting costs a lock
 * and a cycle check, and no milestone asks for it.
 */
export interface UpdateTaskInput {
  title?: string;
  description?: string;
  /**
   * Three-valued, and the distinction is load-bearing: `undefined` means "leave
   * the assignee alone", `null` means "unassign", an Actor means "assign to this
   * person or agent". The existing COALESCE idiom in updateTask cannot express
   * the clear — it reads null as "no value supplied" — so the repository tests
   * for the key's presence instead. Harmless for title and description, neither
   * nullable; fatal here, where clearing the field IS one of the things a user
   * wants to do. 011 widened the value from a bare id to an Actor; the
   * three-valued shape did not change.
   */
  assignee?: Actor | null;
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
   * Two-valued, priority's rule: 'task' is a value, so clearing never needs
   * null, which stays free to mean "not supplied" and lets COALESCE serve.
   */
  type?: TaskType;
  /**
   * Three-valued, dueDate's rule: no number means "unestimated" — 0 is an
   * estimate — so `null` is the cleared state and cannot also be the absent
   * one. `undefined` leaves the estimate alone; `null` clears it.
   */
  estimate?: number | null;
  /**
   * Three-valued for the same reason: there is no milestone id meaning
   * "none", so `null` is the cleared state. Whether the id names a milestone
   * of *this task's board* is a tenancy question, answered in the repository.
   */
  milestoneId?: number | null;
  /**
   * Three-valued, milestoneId's twin (028): `null` un-schedules to the
   * backlog. The repository refuses a completed sprint (its scope is frozen)
   * and a cross-board one, the milestone tenancy check's shape.
   */
  sprintId?: number | null;
  /**
   * Three-valued, milestoneId's twin (031): `null` un-files the task. The
   * repository refuses a cross-board epic, assertEpicOnBoard's tenancy check.
   */
  epicId?: number | null;
  /**
   * Three-valued, estimate's rule (034): 0 is a real value, so `null` is the
   * cleared (unscored) state and `undefined` leaves it alone. The score is
   * derived, so there is nothing to set for it — only its inputs.
   */
  value?: number | null;
  /** Three-valued, value's twin (034). */
  risk?: number | null;
  /**
   * Three-valued, dueDate's rule (032): no date means "no start date", so `null`
   * is the cleared state and cannot also be the absent one. `undefined` leaves
   * it alone; `null` clears it.
   */
  startDate?: string | null;
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
  /**
   * Three-valued, like assignee and dueDate: `undefined` leaves the rule alone,
   * `null` clears it (this task no longer recurs), a frequency sets it. There is
   * no frequency that means "no recurrence", so null cannot also mean "absent" —
   * the repository tests for the key's presence, not COALESCE. 006's rule.
   */
  recurrence?: RecurrenceFrequency | null;
}

export interface MoveTaskInput {
  columnId: number;
  position: number;
}
