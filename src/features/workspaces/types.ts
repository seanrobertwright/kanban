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
