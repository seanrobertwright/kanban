import type { LabelRef } from "@/features/labels/types";
import type { TaskPriority } from "@/features/tasks/types";

/**
 * A saved task shape (019): the reusable half of a task — title, description,
 * priority, labels — that the New-task flow prefills from. Never the per-instance
 * half (assignee, due date, placement); see the migration for why.
 *
 * Workspace-scoped and shared, like the label vocabulary it draws from (007).
 * Carries labels as {id, name} — LabelRef, the same as a task — so the picker can
 * name them without a second lookup; the colour is resolved client-side against
 * the vocabulary, exactly as a card's chips are.
 */
export interface TaskTemplate {
  id: number;
  workspaceId: string;
  title: string;
  description: string;
  priority: TaskPriority;
  labels: LabelRef[];
  createdAt: string;
}

export interface CreateTemplateInput {
  title: string;
  description?: string;
  priority?: TaskPriority;
  /** Ids, not refs — the caller says which labels; the database knows their names. */
  labelIds?: number[];
}

/**
 * Every field two-valued: title and description are not nullable (COALESCE reads
 * an absent one as "leave it"), priority clears to 'none' rather than null, and
 * labelIds uses [] for "no labels". So none of them needs the supplied-flag the
 * task's assignee/dueDate carry — 006's rule, holding across the shape.
 */
export interface UpdateTemplateInput {
  title?: string;
  description?: string;
  priority?: TaskPriority;
  labelIds?: number[];
}

/** Long enough to name any task, short enough to police as shape at the API. */
export const TEMPLATE_TITLE_MAX = 200;
