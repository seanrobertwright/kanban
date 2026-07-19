/**
 * A checklist item: a line of text and a tick, scoped to one task (017). The
 * lightest unit of work-not-forgotten — see the migration for why this is not a
 * subtask.
 */
export interface ChecklistItem {
  id: number;
  taskId: number;
  content: string;
  done: boolean;
  position: number;
  createdAt: string;
}

export interface CreateChecklistItemInput {
  content: string;
}

export interface UpdateChecklistItemInput {
  /** Absent leaves it alone (neither field is nullable — COALESCE expresses both). */
  content?: string;
  done?: boolean;
}

/** Long enough for a reminder, short enough that it is an item and not a task. */
export const CHECKLIST_CONTENT_MAX = 500;
