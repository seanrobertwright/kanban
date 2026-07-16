import { query, queryOne, withTransaction } from "@/shared/db/client";
import { logActivity } from "@/features/activity/server/repository";
import type { Actor, CommentSnapshot } from "@/features/activity/types";
import {
  asPrincipal,
  principalActor,
} from "@/features/auth/server/principal";
import type { Principal } from "@/features/auth/server/principal";
import {
  AuthzError,
  ROLE_RANK,
  requireTaskRole,
} from "@/features/workspaces/server/authz";
import type { WorkspaceRole } from "@/features/workspaces/types";
import type {
  Comment,
  CommentEntry,
  CreateCommentInput,
  UpdateCommentInput,
} from "../types";

/**
 * Prefixed for the joins where `id` is ambiguous — comment, task and "user" all
 * have one — and bare for INSERT ... RETURNING, which has no alias to prefix
 * with. A function rather than two constants that would drift apart.
 */
const commentColumns = (p: "" | "c." = "") =>
  `${p}id, ${p}task_id AS "taskId", ${p}author_type AS "authorType",
   ${p}author_id AS "authorId", ${p}body,
   ${p}created_at AS "createdAt", ${p}updated_at AS "updatedAt"`;

/** Every caller here is a signed-in person; agents become authors at M2. */
function human(userId: string): Actor {
  return { type: "human", id: userId };
}

function snapshot(comment: Comment): CommentSnapshot {
  return {
    commentId: comment.id,
    body: comment.body,
    author: { type: comment.authorType, id: comment.authorId },
  };
}

/**
 * The author check, and the reason it tests the type as well as the id: from M2
 * an agent's id sits in this same column, and nothing guarantees the two id
 * spaces stay disjoint. Comparing only the id would let a user edit an agent's
 * comment the day those spaces happen to collide — a bug that would be
 * essentially unfindable. The type costs one comparison now.
 */
function isAuthor(comment: Comment, userId: string): boolean {
  return comment.authorType === "human" && comment.authorId === userId;
}

/**
 * Editing is the author's alone — admins included, deliberately.
 *
 * An admin who can rewrite your words can put words in your mouth, under your
 * name and avatar, with the audit trail recording only that "a comment was
 * edited". Deleting is different in kind: it removes a remark, it does not forge
 * one, and a workspace does need a way to take down something abusive or a wrong
 * agent report (M2) whose author is unavailable. So the line is drawn between
 * the two rather than around a single "moderate" permission.
 */
function editableBy(comment: Comment, userId: string): boolean {
  return isAuthor(comment, userId);
}

function deletableBy(
  comment: Comment,
  userId: string,
  role: WorkspaceRole
): boolean {
  return isAuthor(comment, userId) || ROLE_RANK[role] >= ROLE_RANK.admin;
}

interface CommentAccess {
  comment: Comment;
  role: WorkspaceRole;
  boardId: number;
  workspaceId: string;
}

/**
 * Resolves a comment and the caller's standing on it in a single join, and
 * reports anything it cannot find as "not_found" — the rule authz.ts states and
 * the reason this is one query rather than "select the comment, then check the
 * task". Splitting it would answer "no such comment" and "that comment is in
 * someone else's workspace" with two different messages behind the same 404,
 * which is exactly the oracle the single-join rule exists to close.
 */
async function requireCommentAccess(
  userId: string,
  commentId: number
): Promise<CommentAccess> {
  const row = await queryOne<
    Comment & { role: WorkspaceRole; boardId: number; workspaceId: string }
  >(
    `SELECT ${commentColumns("c.")},
            wm.role, bc.board_id AS "boardId", b.workspace_id AS "workspaceId"
       FROM comment c
       JOIN task t ON t.id = c.task_id
       JOIN board_column bc ON bc.id = t.column_id
       JOIN board b ON b.id = bc.board_id
       JOIN workspace_member wm
         ON wm.workspace_id = b.workspace_id AND wm.user_id = $2
      WHERE c.id = $1`,
    [commentId, userId]
  );
  if (!row) throw new AuthzError("not_found", "Comment not found");

  const { role, boardId, workspaceId, ...comment } = row;
  return { comment, role, boardId, workspaceId };
}

/**
 * A task's comments, oldest first — a conversation, not an audit trail.
 *
 * Two LEFT JOINs resolve the author's name, one per author kind and gated on
 * author_type, exactly as the activity feed's do: a human's remark resolves
 * through "user", an agent's through "agent" (009) — so an agent report reads
 * under the agent's name rather than "An agent". Both tolerate absence: author_id
 * carries no foreign key, so a deleted author's remarks outlive them as a null
 * name, which the UI renders rather than dropping the row.
 */
export async function listCommentsForTask(
  userId: string,
  taskId: number
): Promise<CommentEntry[]> {
  const { role } = await requireTaskRole(userId, taskId, "viewer");

  const rows = await query<
    Comment & { authorName: string | null; authorImage: string | null }
  >(
    `SELECT ${commentColumns("c.")},
            COALESCE(u.name, ag.name) AS "authorName",
            COALESCE(u.image, ag.image) AS "authorImage"
       FROM comment c
       LEFT JOIN "user" u
         ON u.id = c.author_id AND c.author_type = 'human'
       LEFT JOIN agent ag
         ON ag.id = c.author_id AND c.author_type = 'agent'
      WHERE c.task_id = $1
      ORDER BY c.id ASC`,
    [taskId]
  );

  return rows.map((row) => ({
    ...row,
    canEdit: editableBy(row, userId),
    canDelete: deletableBy(row, userId, role),
  }));
}

/**
 * "viewer", not "member" — the one place comments diverge from every other
 * mutation in this codebase, and the divergence is deliberate.
 *
 * It follows the line 004 already drew for assignees: assignment says whose work
 * it is, roles say who may edit the board. A viewer can already be handed a task
 * — and a viewer who cannot comment has been handed work with no way to report
 * back on it, or to ask a question about it. Commenting is participation, not
 * board mutation: it moves no card and changes no state anyone plans against.
 *
 * The membership invariant 005_comment.sql documents needs no separate check
 * here, unlike 004's assertAssignable. The difference is who is named: an
 * assignee is someone *else*, so their membership is an open question, whereas
 * an author is the caller, and requireTaskRole has just proved the caller is a
 * member of this task's workspace. The invariant holds by construction — which
 * is why it is worth stating that it does, rather than leaving the absence of a
 * check to look like an oversight.
 */
export async function createComment(
  actor: string | Principal,
  input: CreateCommentInput
): Promise<Comment> {
  // The author columns come straight from the principal — 'human'/user id or
  // 'agent'/agent id — where this INSERT used to hardcode 'human'. That single
  // hardcode was the last thing pinning comments to people; §7.1 makes
  // comment_on_task an agent tool, and this is the door it comes through.
  const by = principalActor(asPrincipal(actor));
  const { boardId, workspaceId } = await requireTaskRole(
    actor,
    input.taskId,
    "viewer"
  );

  return withTransaction(async (client) => {
    const { rows } = await client.query<Comment>(
      `INSERT INTO comment (task_id, author_type, author_id, body)
       VALUES ($1, $2, $3, $4)
       RETURNING ${commentColumns()}`,
      [input.taskId, by.type, by.id, input.body]
    );
    const comment = rows[0];

    await logActivity(client, {
      workspaceId,
      boardId,
      taskId: input.taskId,
      actor: by,
      action: "comment.created",
      // No `before`: the comment did not exist. Undo inverts this to a delete.
      after: snapshot(comment),
    });
    return comment;
  });
}

export async function updateComment(
  userId: string,
  id: number,
  input: UpdateCommentInput
): Promise<Comment> {
  const { comment, boardId, workspaceId } = await requireCommentAccess(
    userId,
    id
  );
  if (!editableBy(comment, userId)) {
    throw new AuthzError("forbidden", "Only the author can edit a comment");
  }

  // No-ops are not mutations — the rule the task repository already follows.
  // Returning early keeps an edit that changed nothing out of the history, and
  // also leaves updated_at alone: bumping it would render "(edited)" on a
  // comment nobody edited, which is a false claim about a person's words.
  if (comment.body === input.body) return comment;

  return withTransaction(async (client) => {
    const { rows } = await client.query<Comment>(
      `UPDATE comment SET body = $2, updated_at = now()
        WHERE id = $1
        RETURNING ${commentColumns()}`,
      [id, input.body]
    );
    const after = rows[0];

    await logActivity(client, {
      workspaceId,
      boardId,
      taskId: comment.taskId,
      actor: human(userId),
      action: "comment.updated",
      before: snapshot(comment),
      after: snapshot(after),
    });
    return after;
  });
}

export async function deleteComment(
  userId: string,
  id: number
): Promise<boolean> {
  const { comment, role, boardId, workspaceId } = await requireCommentAccess(
    userId,
    id
  );
  if (!deletableBy(comment, userId, role)) {
    throw new AuthzError(
      "forbidden",
      "Only the author or an admin can delete a comment"
    );
  }

  return withTransaction(async (client) => {
    const { rowCount } = await client.query(`DELETE FROM comment WHERE id = $1`, [
      id,
    ]);
    if (!rowCount) return false;

    // `before` carries the author, not just the body — and this is the row that
    // proves why CommentSnapshot records it. An admin deleting someone else's
    // remark makes the actor and the author two different people, and without
    // the snapshot the log would say only that an admin deleted *a* comment.
    await logActivity(client, {
      workspaceId,
      boardId,
      taskId: comment.taskId,
      actor: human(userId),
      action: "comment.deleted",
      before: snapshot(comment),
    });
    return true;
  });
}
