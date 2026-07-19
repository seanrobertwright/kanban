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
}

export interface UpdateMilestoneInput {
  name?: string;
  /** Three-valued: undefined leaves the date, null clears it. */
  dueDate?: string | null;
}
