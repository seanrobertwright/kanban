import {
  getSessionFromRequest,
  unauthorized,
} from "@/features/auth/server/session";
import { authzErrorResponse } from "@/features/workspaces/server/authz";
import {
  createTask,
  deleteTask,
  getTask,
  moveTask,
  updateTask,
} from "./repository";

function badRequest(message: string) {
  return Response.json({ error: message }, { status: 400 });
}

function notFound() {
  return Response.json({ error: "Task not found" }, { status: 404 });
}

/**
 * null is a legal value ("unassign"), undefined is its absence ("leave alone"),
 * and both must pass — which is why this is not the usual `typeof x === "string"`
 * guard. Whether the id names a real member of this workspace is not decided
 * here: that is a tenancy question, and it is answered in the repository next to
 * the RBAC checks, against the same transaction that does the write.
 */
function isAssigneeId(value: unknown): value is string | null | undefined {
  return value === undefined || value === null || typeof value === "string";
}

export async function handleCreateTask(request: Request) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return badRequest("Invalid JSON body");

  const { columnId, title, description, assigneeId } = body as Record<
    string,
    unknown
  >;
  if (typeof columnId !== "number") return badRequest("columnId is required");
  if (typeof title !== "string" || title.trim() === "")
    return badRequest("title is required");
  if (description !== undefined && typeof description !== "string")
    return badRequest("description must be a string");
  if (!isAssigneeId(assigneeId))
    return badRequest("assigneeId must be a user id or null");

  try {
    const task = await createTask(session.user.id, {
      columnId,
      title: title.trim(),
      description,
      assigneeId,
    });
    return Response.json(task, { status: 201 });
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleUpdateTask(request: Request, id: number) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();
  if (!Number.isInteger(id)) return badRequest("Invalid task id");

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return badRequest("Invalid JSON body");

  const { title, description, columnId, position, assigneeId } = body as Record<
    string,
    unknown
  >;

  // Presence, not value. `{"assigneeId": null}` is a request to unassign and
  // must be told apart from a PATCH that never mentions the assignee — and
  // destructuring alone cannot: both hand back undefined.
  const setsAssignee = "assigneeId" in body;

  try {
    // A move request carries columnId + position; a content edit carries
    // title/description. Both may arrive in one PATCH.
    if (columnId !== undefined || position !== undefined) {
      if (typeof columnId !== "number" || typeof position !== "number")
        return badRequest("columnId and position are both required to move");
      const moved = await moveTask(session.user.id, id, { columnId, position });
      if (!moved) return notFound();
    }

    if (title !== undefined || description !== undefined || setsAssignee) {
      if (title !== undefined && (typeof title !== "string" || !title.trim()))
        return badRequest("title must be a non-empty string");
      if (description !== undefined && typeof description !== "string")
        return badRequest("description must be a string");
      if (!isAssigneeId(assigneeId))
        return badRequest("assigneeId must be a user id or null");

      const updated = await updateTask(session.user.id, id, {
        title: title as string | undefined,
        description: description as string | undefined,
        // Spread, so the key exists only when the caller sent it. Writing
        // `assigneeId: assigneeId` unconditionally would put an explicit
        // undefined on the object — and `"assigneeId" in input` would then be
        // true for every title-only edit, turning each one into an unassign.
        ...(setsAssignee ? { assigneeId: assigneeId ?? null } : {}),
      });
      if (!updated) return notFound();
      return Response.json(updated);
    }

    const task = await getTask(session.user.id, id);
    return task ? Response.json(task) : notFound();
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleDeleteTask(request: Request, id: number) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();
  if (!Number.isInteger(id)) return badRequest("Invalid task id");

  try {
    return (await deleteTask(session.user.id, id))
      ? new Response(null, { status: 204 })
      : notFound();
  } catch (error) {
    return authzErrorResponse(error);
  }
}
