import { getPrincipalFromRequest } from "@/features/auth/server/agent-auth";
import {
  getSessionFromRequest,
  unauthorized,
} from "@/features/auth/server/session";
import { authzErrorResponse } from "@/features/workspaces/server/authz";
import {
  createEpic,
  deleteEpic,
  listEpics,
  updateEpic,
} from "./repository";

// Reads take a principal (an agent that can read a board can read its
// groupings); management takes a session — the split milestone draws.

function badRequest(message: string) {
  return Response.json({ error: message }, { status: 400 });
}

function notFound() {
  return Response.json({ error: "Epic not found" }, { status: 404 });
}

export async function handleListEpics(request: Request, id: string) {
  const principal = await getPrincipalFromRequest(request);
  if (!principal) return unauthorized();
  const boardId = Number(id);
  if (!Number.isInteger(boardId)) return badRequest("Invalid board id");
  try {
    return Response.json(await listEpics(principal, boardId));
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleCreateEpic(request: Request, id: string) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();
  const boardId = Number(id);
  if (!Number.isInteger(boardId)) return badRequest("Invalid board id");

  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object")
    return badRequest("Invalid JSON body");
  const { name } = payload as Record<string, unknown>;
  if (typeof name !== "string" || name.trim() === "")
    return badRequest("name is required");

  try {
    const epic = await createEpic(
      session.user.id,
      boardId,
      { name: name.trim() },
      { type: "human", id: session.user.id }
    );
    return Response.json(epic, { status: 201 });
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleUpdateEpic(request: Request, id: string) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();
  const epicId = Number(id);
  if (!Number.isInteger(epicId)) return badRequest("Invalid epic id");

  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object")
    return badRequest("Invalid JSON body");
  const { name } = payload as Record<string, unknown>;
  if (name !== undefined && (typeof name !== "string" || name.trim() === ""))
    return badRequest("name must be a non-empty string");

  try {
    const epic = await updateEpic(
      session.user.id,
      epicId,
      { name: name as string | undefined },
      { type: "human", id: session.user.id }
    );
    return epic ? Response.json(epic) : notFound();
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleDeleteEpic(request: Request, id: string) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();
  const epicId = Number(id);
  if (!Number.isInteger(epicId)) return badRequest("Invalid epic id");

  try {
    return (await deleteEpic(session.user.id, epicId, {
      type: "human",
      id: session.user.id,
    }))
      ? new Response(null, { status: 204 })
      : notFound();
  } catch (error) {
    return authzErrorResponse(error);
  }
}
