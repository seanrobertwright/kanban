/**
 * A larger-than-task grouping a board's work rolls up into (031), one level above
 * a milestone — "Billing", "Onboarding". Board-scoped like a milestone: a second
 * board's "Billing" is a different epic. Unlike a milestone it has no due date —
 * an epic is an open-ended bucket, and the date that matters belongs to the
 * milestones inside it.
 */
export interface Epic {
  id: number;
  boardId: number;
  name: string;
  createdAt: string;
  /**
   * Progress, derived at read time: how many top-level tasks roll up into this
   * epic — directly (task.epic_id) or through a member milestone — and how many
   * of those sit in the board's done column. done ≤ total; both 0 for a fresh
   * epic, and done stays 0 on a board with no done column, the milestone rule.
   */
  total: number;
  done: number;
}

export interface CreateEpicInput {
  name: string;
}

export interface UpdateEpicInput {
  name?: string;
}
