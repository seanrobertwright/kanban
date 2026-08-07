/**
 * Resource & capacity planning (041). Two capabilities on one model: a member's
 * role and weekly point budget (resource planning — planning work against people
 * and roles) read against the open work assigned to them (capacity planning —
 * demand vs capacity, flagging over-allocation).
 */

/** A member's capacity row as stored — role + weekly point budget. */
export interface MemberCapacity {
  userId: string;
  weeklyPoints: number;
  role: string;
}

/** A dated absence (090), inclusive on both ends. */
export interface TimeOff {
  id: number;
  userId: string;
  /** ISO date (YYYY-MM-DD), inclusive. */
  startsOn: string;
  /** ISO date (YYYY-MM-DD), inclusive. */
  endsOn: string;
  note: string;
}

export interface CreateTimeOffInput {
  userId: string;
  startsOn: string;
  endsOn: string;
  note?: string;
}

/** One person's line in a board's capacity plan: their role and budget beside the
 *  open work assigned to them on this board. */
export interface CapacityRow {
  userId: string;
  name: string;
  role: string;
  /** Nominal points per week this member can carry, as stored. 0 = none set. */
  weeklyPoints: number;
  /** Whole workdays (Mon–Fri) this member is away inside the plan's week (090). */
  daysOff: number;
  /** weeklyPoints prorated by the workdays they are actually here — the budget
   *  the plan should be read against. Equals weeklyPoints when daysOff is 0. */
  availablePoints: number;
  /** Open (not-done) assigned estimate on this board — the demand on them. */
  committedPoints: number;
  /** How many open top-level tasks are assigned to them here. */
  openTasks: number;
  /** committedPoints / availablePoints, or null when there is no meaningful
   *  ratio — no budget set, or no capacity left this week (away throughout).
   *  Over-allocation is a separate question; see `isOverAllocated`. */
  utilization: number | null;
  /** This member's absences from the plan's week onward, soonest first — so the
   *  dialog can show and revoke them without a second read. */
  timeOff: TimeOff[];
}

/** A board's whole capacity picture: a row per member, the unassigned open work,
 *  and the workspace-vs-board rollup. */
export interface CapacityPlan {
  rows: CapacityRow[];
  /** Open top-level work with no assignee at all — demand nobody is carrying yet. */
  unassigned: { points: number; tasks: number };
  /** Open top-level work held by agents. No per-agent row — an agent has no
   *  point budget — but the demand is real and must not vanish from the plan. */
  agents: { points: number; tasks: number };
  /** `capacity` is the nominal sum, `available` the same sum after time off. */
  totals: { capacity: number; available: number; committed: number };
  /** The Mon–Sun window the availability is measured over (ISO dates), so the
   *  UI can name the week it is reporting rather than implying "always". */
  week: { start: string; end: string };
}

export interface SetMemberCapacityInput {
  weeklyPoints: number;
  role: string;
}

export const ROLE_MAX = 40;
/** A weekly point budget above this is a data-entry slip, not a plan. */
export const WEEKLY_POINTS_MAX = 1000;
export const TIME_OFF_NOTE_MAX = 120;
/** A single absence longer than a year is a leaver, not time off. */
export const TIME_OFF_MAX_DAYS = 366;
