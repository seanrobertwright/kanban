import { getPrincipalFromRequest } from "@/features/auth/server/agent-auth";
import {
  getSessionFromRequest,
  unauthorized,
} from "@/features/auth/server/session";
import { authzErrorResponse } from "@/features/workspaces/server/authz";
import {
  createComment,
  deleteComment,
  listCommentsForTask,
  updateComment,
} from "./repository";

function badRequest(message: string) {
  return Response.json({ error: message }, { status: 400 });
}

/**
 * Shape only — whether the caller may comment on this task is a tenancy
 * question, answered in the repository against the same transaction as the
 * write, as everywhere else here.
 *
 * Trimming happens on the way in so the CHECK in 005_comment.sql never fires:
 * an all-whitespace body is a 400 the user can act on, not a 500 from a
 * constraint violation. The constraint stays regardless — it is what makes the
 * rule true of the table rather than of this one code path, and at M2 an agent
 * reaches the same table through a different door.
 */
function parseBody(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const body = value.trim();
  return body === "" ? null : body;
}

export async function handleListComments(request: Request, id: string) {
  // getPrincipalFromRequest, not getSessionFromRequest: §7.1 makes an agent a
  // citizen of the same access path a human is, and reading the thread it comments
  // into is part of that path — the same widening the activity feed already has.
  const principal = await getPrincipalFromRequest(request);
  if (!principal) return unauthorized();

  const taskId = Number(id);
  if (!Number.isInteger(taskId)) return badRequest("Invalid task id");

  try {
    return Response.json(await listCommentsForTask(principal, taskId));
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleCreateComment(request: Request, id: string) {
  // The one comment handler an agent reaches (comment_on_task, §7.1). Editing and
  // deleting stay human-only — an agent reports, it does not moderate — so those
  // handlers still resolve a session directly.
  const principal = await getPrincipalFromRequest(request);
  if (!principal) return unauthorized();

  const taskId = Number(id);
  if (!Number.isInteger(taskId)) return badRequest("Invalid task id");

  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object")
    return badRequest("Invalid JSON body");

  const body = parseBody((payload as Record<string, unknown>).body);
  if (body === null) return badRequest("body must be a non-empty string");

  try {
    const comment = await createComment(principal, { taskId, body });
    return Response.json(comment, { status: 201 });
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleUpdateComment(request: Request, id: string) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();

  const commentId = Number(id);
  if (!Number.isInteger(commentId)) return badRequest("Invalid comment id");

  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object")
    return badRequest("Invalid JSON body");

  const body = parseBody((payload as Record<string, unknown>).body);
  if (body === null) return badRequest("body must be a non-empty string");

  try {
    return Response.json(await updateComment(session.user.id, commentId, { body }));
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleDeleteComment(request: Request, id: string) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();

  const commentId = Number(id);
  if (!Number.isInteger(commentId)) return badRequest("Invalid comment id");

  try {
    // A comment that survived requireCommentAccess and then vanished before the
    // DELETE is a race, not a missing route — 404 is still the honest answer,
    // and requireCommentAccess raises it for the ordinary "no such comment".
    return (await deleteComment(session.user.id, commentId))
      ? new Response(null, { status: 204 })
      : Response.json({ error: "Comment not found" }, { status: 404 });
  } catch (error) {
    return authzErrorResponse(error);
  }
}
