/**
 * A named checkpoint a board's tasks aim at (026) — "v1.0", "Beta launch".
 * Board-scoped, unlike the label vocabulary: a second board's v1.0 is a
 * different v1.0.
 */
export interface Milestone {
  id: number;
  boardId: number;
  name: string;
  /** 'YYYY-MM-DD' or null — a milestone can be a bucket before it is a deadline. */
  dueDate: string | null;
  /**
   * The epic this milestone is filed under (031), or null. An id, not a ref —
   * the board holds the epic list, milestoneId's rule one level up. This is the
   * "above the milestone" hierarchy: a milestone rolls up into an epic.
   */
  epicId: number | null;
  /**
   * The objective this milestone aims at (037), or null. An id like epicId — the
   * board holds the objective list. A whole checkpoint contributing to an
   * outcome, beside filing under an epic (the two are independent).
   */
  objectiveId: number | null;
  createdAt: string;
  /**
   * Progress, derived at read time: how many top-level tasks aim here, and how
   * many of those sit in the board's done column. done ≤ total; both 0 for a
   * fresh milestone, and done stays 0 on a board with no done column — the
   * honest zero blockedByOpenCount already established.
   */
  total: number;
  done: number;
}

export interface CreateMilestoneInput {
  name: string;
  dueDate?: string | null;
  /** The epic to file under (031), or null/absent for none. */
  epicId?: number | null;
  /** The objective to aim at (037), or null/absent for none. */
  objectiveId?: number | null;
}

export interface UpdateMilestoneInput {
  name?: string;
  /** Three-valued: undefined leaves the date, null clears it. */
  dueDate?: string | null;
  /** Three-valued, dueDate's twin (031): null un-files from the epic. */
  epicId?: number | null;
  /** Three-valued, epicId's twin (037): null un-aims from the objective. */
  objectiveId?: number | null;
}
