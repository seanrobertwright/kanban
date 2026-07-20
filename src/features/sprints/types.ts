/**
 * A sprint (028) — a timeboxed, committed scope of one board's work, with a
 * lifecycle. Unlike a milestone (a target a task aims at), a sprint owns a
 * window and a status, which is what lets velocity and burndown measure it.
 */
export type SprintStatus = "planning" | "active" | "completed";

export const SPRINT_STATUSES: readonly SprintStatus[] = [
  "planning",
  "active",
  "completed",
] as const;

export const SPRINT_STATUS_LABELS: Record<SprintStatus, string> = {
  planning: "Planning",
  active: "Active",
  completed: "Completed",
};

export function isSprintStatus(value: unknown): value is SprintStatus {
  return (
    typeof value === "string" &&
    (SPRINT_STATUSES as readonly string[]).includes(value)
  );
}

export interface Sprint {
  id: number;
  boardId: number;
  name: string;
  goal: string;
  /** 'YYYY-MM-DD' or null — a planning sprint may have no window yet. */
  startDate: string | null;
  endDate: string | null;
  status: SprintStatus;
  createdAt: string;
  /**
   * Progress, derived at read time, top-level tasks only (subtasks complete
   * with their parent): how many tasks are in the sprint, how many are done
   * (in the board's done column — honest zero without one), and the same split
   * in story points. donePoints is what burndown will read; points is the
   * committed total velocity will read once the sprint completes.
   */
  total: number;
  done: number;
  points: number;
  donePoints: number;
}

/**
 * One assignee's load within a sprint — the PRD's payoff (§4.3): planning
 * "counts agent capacity alongside human capacity". assigneeId null is the
 * unassigned bucket; type says which roster resolves the name.
 */
export interface SprintCapacityRow {
  sprintId: number;
  assigneeType: "human" | "agent" | null;
  assigneeId: string | null;
  count: number;
  points: number;
}

export interface CreateSprintInput {
  name: string;
  goal?: string;
  startDate?: string | null;
  endDate?: string | null;
}

export interface UpdateSprintInput {
  name?: string;
  goal?: string;
  /** Three-valued: undefined leaves it, null clears the date. */
  startDate?: string | null;
  endDate?: string | null;
}
