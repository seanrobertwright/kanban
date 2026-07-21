import type { BoardFilter } from "@/features/board/components/board-filter-bar";

/**
 * The lenses the board offers. Defined here (not in board.tsx) so the
 * saved-view slice, the board, and the API all name them once. The values match
 * the CHECK constraint in 015, widened by 029 to admit 'backlog' — the
 * sprint_id IS NULL queue as its own drag-to-sprint planning surface (028/M4) —
 * and by 032 to admit 'timeline', the start_date→due_date span view.
 */
export const BOARD_VIEW_MODES = [
  "board",
  "list",
  "calendar",
  "backlog",
  "timeline",
] as const;
export type BoardViewMode = (typeof BOARD_VIEW_MODES)[number];

export function isBoardViewMode(value: unknown): value is BoardViewMode {
  return (
    typeof value === "string" &&
    (BOARD_VIEW_MODES as readonly string[]).includes(value)
  );
}

/**
 * A saved view is a name over a (lens + filter) pair. `filter` is exactly the
 * board's client-side BoardFilter — the type is imported rather than redeclared
 * so the two cannot drift; the import is type-only, so nothing of the client
 * component crosses into the server code that also reads this file.
 */
export interface SavedView {
  id: number;
  workspaceId: string;
  name: string;
  viewMode: BoardViewMode;
  filter: BoardFilter;
  createdAt: string;
}

export interface CreateSavedViewInput {
  name: string;
  viewMode: BoardViewMode;
  filter: BoardFilter;
}

/** Long enough to name a view, short enough to sit in a dropdown row. */
export const SAVED_VIEW_NAME_MAX = 40;
