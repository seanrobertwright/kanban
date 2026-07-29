/**
 * A task referenced in a dependency relationship — just enough to name it (018).
 *
 * id and title, never the whole Task: the "Blocked by" list and the picker below
 * it render a name and link to open the task, and nothing on either needs a
 * card's worth of fields. A blocker can be any task on the board, including a
 * subtask that never reaches it, so the title has to travel from the server —
 * the board's client-side task list cannot be assumed to hold it.
 */
export interface TaskDependencyRef {
  id: number;
  title: string;
}

/**
 * What the edge means (087). FS is the default and the only one 018 could say.
 *
 *   FS  the blocker must FINISH before this task STARTS  — the ordinary case
 *   SS  the blocker must START  before this task STARTS  — run them together
 *   FF  the blocker must FINISH before this task FINISHES — land them together
 *
 * SF is absent on purpose; see 087 for why a backwards link earns nothing in a
 * plan that is only ever scheduled forwards.
 */
export const DEPENDENCY_TYPES = ["FS", "SS", "FF"] as const;
export type DependencyType = (typeof DEPENDENCY_TYPES)[number];

export function isDependencyType(value: unknown): value is DependencyType {
  return (
    typeof value === "string" &&
    (DEPENDENCY_TYPES as readonly string[]).includes(value)
  );
}

/** The bounds the CHECK in 087 enforces, restated so the client can refuse a
 * value before spending a round trip on it. Signed: negative is a lead. */
export const LAG_DAYS_MIN = -365;
export const LAG_DAYS_MAX = 365;

export function isLagDays(value: unknown): value is number {
  return (
    Number.isInteger(value) &&
    (value as number) >= LAG_DAYS_MIN &&
    (value as number) <= LAG_DAYS_MAX
  );
}

/** How an edge reads in a sentence: "Finish → start", "Start → start +2d". */
export const DEPENDENCY_TYPE_LABELS: Record<DependencyType, string> = {
  FS: "Finish → start",
  SS: "Start → start",
  FF: "Finish → finish",
};

/** The type and offset of one edge, the pair every consumer needs together —
 * a type with no lag under-describes the link as often as the reverse. */
export interface DependencyLink {
  type: DependencyType;
  lagDays: number;
}

/** FS with no offset: what every edge written before 087 means, and what an
 * add that names neither gets. Consumers use it as the fallback for an edge
 * whose link they could not resolve, so the pre-087 reading is always the
 * safe one. */
export const DEFAULT_LINK: DependencyLink = { type: "FS", lagDays: 0 };

/** "+2d" / "−1d" / "" — the offset as it appears next to a type label. */
export function lagLabel(lagDays: number): string {
  if (lagDays === 0) return "";
  // U+2212, not a hyphen: this sits beside a type label as prose, and a lead
  // read as "FS -2d" invites parsing the dash as part of the type.
  return lagDays > 0 ? `+${lagDays}d` : `−${Math.abs(lagDays)}d`;
}

/**
 * What one task's dependency section needs in a single fetch: the blockers it
 * already has, and the tasks it could add as blockers.
 *
 * Both in one payload rather than two round trips, because the section shows
 * both the moment it mounts — the current list and the "add" picker's options.
 * Candidates are server-authoritative: same board, never self, never an existing
 * blocker, and never a task that (transitively) depends on this one, since adding
 * that would close a cycle. The server refuses a cycle on write regardless; this
 * just keeps the picker from offering a choice it would reject.
 */
export interface TaskDependencies {
  /** Tasks this task is blocked by — its dependencies. */
  dependencies: TaskDependencyEntry[];
  /** Same-board tasks that could be added as a blocker without cycling. */
  candidates: TaskDependencyRef[];
}

/**
 * A blocker as the dialog lists it: which task, and what the link to it means.
 *
 * Only the `dependencies` side carries a link — a candidate is a task that
 * *could* be blocked on, and it has no relationship to describe until one is
 * created. Keeping the link off TaskDependencyRef is what stops the picker from
 * having to invent an FS/0 it does not mean.
 */
export interface TaskDependencyEntry extends TaskDependencyRef, DependencyLink {}

export interface AddDependencyInput {
  /** The task that must finish first — the blocker this task will depend on. */
  dependsOnId: number;
  /**
   * Both optional, and both default to DEFAULT_LINK. That is what keeps 018's
   * callers — and every agent that has ever called flag_blocker — writing the
   * same edge they always did without knowing this field exists.
   */
  type?: DependencyType;
  lagDays?: number;
}

/**
 * One blocked-by edge, board-wide (036). Where TaskDependencyRef names a single
 * task for one dialog's list, this is the bare relationship the Gantt reads
 * across the whole board: `taskId` is blocked by `dependsOnId`. No titles — the
 * Gantt already holds every task's from the board read, so an edge carries only
 * which two tasks it joins and, since 087, what joining them means.
 *
 * The link is on the edge rather than looked up because every consumer that has
 * an edge needs it: the Gantt anchors its arrow at different ends per type, and
 * both the critical path and the proposer compute different dates from it.
 */
export interface TaskDependencyEdge extends DependencyLink {
  taskId: number;
  dependsOnId: number;
}
