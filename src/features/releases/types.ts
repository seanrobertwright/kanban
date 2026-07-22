/**
 * A version a board's delivered work is grouped under (2.8) — "v1.2.0". The
 * milestone's git-native cousin: board-scoped, gathers tasks (task.release_id),
 * and flips planned → released when a human cuts it or a git tag publishes it.
 */

export type ReleaseState = "planned" | "released";

export interface Release {
  id: number;
  boardId: number;
  name: string;
  state: ReleaseState;
  /** Stamped when the release ships (a human close or a git tag). */
  releasedAt: string | null;
  /** Author-supplied, the tag body, or auto-generated at release time. */
  notes: string | null;
  /** The provider's release/tag URL, stamped by the git ingress. */
  url: string | null;
  createdAt: string;
  /** Progress, derived at read time (milestone's rule): top-level tasks aimed
   *  here, and how many sit in the board's done column. done ≤ total. */
  total: number;
  done: number;
}

export interface CreateReleaseInput {
  name: string;
  notes?: string | null;
}

export interface UpdateReleaseInput {
  name?: string;
  /** Three-valued: undefined leaves notes, null clears them. */
  notes?: string | null;
  /** Ship or un-ship the release by hand (the git tag does this automatically). */
  state?: ReleaseState;
}
