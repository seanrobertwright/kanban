export type WorkspaceRole = "owner" | "admin" | "member" | "viewer";

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
}

/** A workspace as seen by one member — includes that member's own role. */
export interface WorkspaceMembership extends Workspace {
  role: WorkspaceRole;
}

export interface Board {
  id: number;
  workspaceId: string;
  name: string;
  position: number;
  createdAt: string;
}

/**
 * One board's line in the portfolio (040): the cross-board rollup that lets an
 * owner glance at every board in a workspace at once rather than switching into
 * each. Counts are top-level tasks only (subtasks complete with their parent,
 * the analytics/epics rule). "done" needs the board to have designated a done
 * column; without one it is an honest 0, milestone/epic progress's convention.
 */
export interface PortfolioBoard {
  id: number;
  name: string;
  /** Top-level tasks on the board. */
  total: number;
  /** Top-level tasks sitting in the board's done column (0 if none designated). */
  done: number;
  /** Whether the board has a done column, so the UI can distinguish 0-of-0 from
   *  "no completion notion" (a board that never picked a done column). */
  hasDoneColumn: boolean;
  /** Milestones defined on the board. */
  milestones: number;
  /** Top-level tasks past their due date and not yet done. */
  overdue: number;
}

/** The whole workspace at a glance — every board's rollup plus the totals across
 *  them (the "portfolio rollup"). */
export interface Portfolio {
  boards: PortfolioBoard[];
  totals: {
    boards: number;
    total: number;
    done: number;
    overdue: number;
  };
}

/**
 * A newly provisioned workspace and the board it was seeded with. The board
 * comes back because the caller's next move is always to navigate to it, and it
 * is not otherwise addressable without a second round trip.
 */
export interface NewWorkspace {
  workspace: WorkspaceMembership;
  board: Board;
}

export interface Member {
  userId: string;
  name: string;
  email: string;
  image: string | null;
  role: WorkspaceRole;
  createdAt: string;
}

export interface Invitation {
  id: string;
  workspaceId: string;
  email: string;
  role: WorkspaceRole;
  createdAt: string;
  expiresAt: string;
}
