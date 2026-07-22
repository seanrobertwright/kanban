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

/** One person's line in a board's capacity plan: their role and budget beside the
 *  open work assigned to them on this board. */
export interface CapacityRow {
  userId: string;
  name: string;
  role: string;
  /** Points per week this member can carry (their capacity). 0 = none set. */
  weeklyPoints: number;
  /** Open (not-done) assigned estimate on this board — the demand on them. */
  committedPoints: number;
  /** How many open top-level tasks are assigned to them here. */
  openTasks: number;
  /** committedPoints / weeklyPoints, or null when no capacity is set — a demand
   *  against an unknown budget has no meaningful ratio. */
  utilization: number | null;
}

/** A board's whole capacity picture: a row per member, the unassigned open work,
 *  and the workspace-vs-board rollup. */
export interface CapacityPlan {
  rows: CapacityRow[];
  /** Open top-level work with no human assignee — demand nobody is carrying yet. */
  unassigned: { points: number; tasks: number };
  totals: { capacity: number; committed: number };
}

export interface SetMemberCapacityInput {
  weeklyPoints: number;
  role: string;
}

export const ROLE_MAX = 40;
/** A weekly point budget above this is a data-entry slip, not a plan. */
export const WEEKLY_POINTS_MAX = 1000;
