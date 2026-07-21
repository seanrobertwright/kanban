import type { ActorType } from "@/features/activity/types";

/**
 * A remark on a task, by a person today and by an agent from M2 (PRD §7.1's
 * comment_on_task). Author is actor-shaped for that reason — see 005_comment.sql
 * for why it carries no foreign key.
 */
export interface Comment {
  id: number;
  taskId: number;
  authorType: ActorType;
  authorId: string;
  body: string;
  createdAt: string;
  /** Null until edited. The flag the UI renders "(edited)" from. */
  updatedAt: string | null;
  /** When the thread was marked handled (024), or null while open. */
  resolvedAt: string | null;
  /** Who resolved it — a user id, humans only. Null while open. */
  resolvedBy: string | null;
  /**
   * The comment this one replies to (033), or null for a top-level remark. One
   * level deep only — subtasks' rule — so a comment with a parent never has
   * replies of its own. The thread nests replies under their parent client-side.
   */
  parentId: number | null;
}

/**
 * A comment joined to its author, for rendering.
 *
 * `canEdit`/`canDelete` are computed on the server rather than re-derived in the
 * client, because they are the *rule* — author may edit their own, admins may
 * delete anyone's — and a rule stated in two places is a rule that will
 * eventually be stated two ways. The client already cannot enforce it: the
 * repository re-checks on every write regardless, since anyone can craft a
 * request. These fields exist so the UI knows which buttons to draw, not to
 * decide anything.
 */
export interface CommentEntry extends Comment {
  /** Null when the author is an agent, or a user who has since been deleted. */
  authorName: string | null;
  authorImage: string | null;
  canEdit: boolean;
  canDelete: boolean;
  /** Member and up (024): resolving is thread housekeeping, not authorship. */
  canResolve: boolean;
}

export interface CreateCommentInput {
  taskId: number;
  body: string;
  /**
   * The comment to reply under (033), or absent for a top-level remark. Must be
   * a top-level comment on the same task — a reply-to-a-reply is refused (depth
   * is 1), the repository's check.
   */
  parentId?: number;
}

export interface UpdateCommentInput {
  body: string;
}
