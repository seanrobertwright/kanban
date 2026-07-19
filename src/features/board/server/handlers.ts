import {
  getSessionFromRequest,
  unauthorized,
} from "@/features/auth/server/session";
import { authzErrorResponse } from "@/features/workspaces/server/authz";
import {
  createColumn,
  deleteColumn,
  moveColumn,
  setColumnWipLimit,
  updateColumn,
} from "./columns";

function badRequest(message: string) {
  return Response.json({ error: message }, { status: 400 });
}

function notFound() {
  return Response.json({ error: "Column not found" }, { status: 404 });
}

export async function handleCreateColumn(request: Request, id: string) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();

  const boardId = Number(id);
  if (!Number.isInteger(boardId)) return badRequest("Invalid board id");

  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object")
    return badRequest("Invalid JSON body");

  const { title } = payload as Record<string, unknown>;
  if (typeof title !== "string" || title.trim() === "")
    return badRequest("title is required");

  try {
    const column = await createColumn(session.user.id, boardId, title.trim());
    return Response.json(column, { status: 201 });
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleUpdateColumn(request: Request, id: string) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();

  const columnId = Number(id);
  if (!Number.isInteger(columnId)) return badRequest("Invalid column id");

  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object")
    return badRequest("Invalid JSON body");

  const { title, position, wipLimit } = payload as Record<string, unknown>;
  // Three-valued, dueDate's shape (023): `{"wipLimit": null}` clears the limit
  // and must be told apart from a PATCH that never mentions it.
  const setsWipLimit = "wipLimit" in payload;

  try {
    // A rename and a reorder are two actions and log two rows, so one PATCH
    // carrying both does both — the shape handleUpdateTask already uses for a
    // move plus an edit.
    if (position !== undefined) {
      if (typeof position !== "number" || !Number.isInteger(position))
        return badRequest("position must be an integer");
      if (!(await moveColumn(session.user.id, columnId, position)))
        return notFound();
    }

    if (setsWipLimit) {
      if (
        wipLimit !== null &&
        (!Number.isInteger(wipLimit) || (wipLimit as number) < 1)
      )
        return badRequest("wipLimit must be a positive integer or null");
      const limited = await setColumnWipLimit(
        session.user.id,
        columnId,
        wipLimit as number | null
      );
      if (!limited) return notFound();
      if (title === undefined) return Response.json(limited);
    }

    if (title !== undefined) {
      if (typeof title !== "string" || title.trim() === "")
        return badRequest("title must be a non-empty string");
      const updated = await updateColumn(session.user.id, columnId, title.trim());
      if (!updated) return notFound();
      return Response.json(updated);
    }

    if (position === undefined) return badRequest("Nothing to update");
    return new Response(null, { status: 204 });
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleDeleteColumn(request: Request, id: string) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();

  const columnId = Number(id);
  if (!Number.isInteger(columnId)) return badRequest("Invalid column id");

  try {
    return (await deleteColumn(session.user.id, columnId))
      ? new Response(null, { status: 204 })
      : notFound();
  } catch (error) {
    // A populated column raises "conflict", which authzErrorResponse maps to
    // 409 — an invariant, not a permission.
    return authzErrorResponse(error);
  }
}
