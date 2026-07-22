import { getPrincipalFromRequest } from "@/features/auth/server/agent-auth";
import {
  getSessionFromRequest,
  unauthorized,
} from "@/features/auth/server/session";
import { authzErrorResponse } from "@/features/workspaces/server/authz";
import {
  createRelease,
  deleteRelease,
  listReleaseTasks,
  listReleases,
  setTaskRelease,
  updateRelease,
} from "./repository";
import type { ReleaseState } from "../types";

// Reads take a principal (an agent that reads a board reads its releases);
// management takes a human session, the milestones split drawn here too.

function badRequest(message: string) {
  return Response.json({ error: message }, { status: 400 });
}
function notFound() {
  return Response.json({ error: "Release not found" }, { status: 404 });
}

const STATES: ReleaseState[] = ["planned", "released"];

export async function handleListReleases(request: Request, id: string) {
  const principal = await getPrincipalFromRequest(request);
  if (!principal) return unauthorized();
  const boardId = Number(id);
  if (!Number.isInteger(boardId)) return badRequest("Invalid board id");
  try {
    return Response.json(await listReleases(principal, boardId));
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleCreateRelease(request: Request, id: string) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();
  const boardId = Number(id);
  if (!Number.isInteger(boardId)) return badRequest("Invalid board id");
  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object") return badRequest("Invalid JSON body");
  const { name, notes } = payload as Record<string, unknown>;
  if (typeof name !== "string" || name.trim() === "")
    return badRequest("name is required");
  if (notes !== undefined && notes !== null && typeof notes !== "string")
    return badRequest("notes must be a string or null");
  try {
    const release = await createRelease(
      session.user.id,
      boardId,
      { name: name.trim(), notes: (notes as string | null) ?? null },
      { type: "human", id: session.user.id }
    );
    return Response.json(release, { status: 201 });
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleUpdateRelease(request: Request, id: string) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();
  const releaseId = Number(id);
  if (!Number.isInteger(releaseId)) return badRequest("Invalid release id");
  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object") return badRequest("Invalid JSON body");
  const { name, notes, state } = payload as Record<string, unknown>;
  if (name !== undefined && (typeof name !== "string" || name.trim() === ""))
    return badRequest("name must be a non-empty string");
  if (notes !== undefined && notes !== null && typeof notes !== "string")
    return badRequest("notes must be a string or null");
  if (state !== undefined && !STATES.includes(state as ReleaseState))
    return badRequest("state must be planned or released");
  const setsNotes = "notes" in payload;

  try {
    const release = await updateRelease(
      session.user.id,
      releaseId,
      {
        name: name as string | undefined,
        ...(setsNotes ? { notes: notes as string | null } : {}),
        ...(state !== undefined ? { state: state as ReleaseState } : {}),
      },
      { type: "human", id: session.user.id }
    );
    return release ? Response.json(release) : notFound();
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleDeleteRelease(request: Request, id: string) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();
  const releaseId = Number(id);
  if (!Number.isInteger(releaseId)) return badRequest("Invalid release id");
  try {
    return (await deleteRelease(session.user.id, releaseId, {
      type: "human",
      id: session.user.id,
    }))
      ? new Response(null, { status: 204 })
      : notFound();
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleListReleaseTasks(request: Request, id: string) {
  const principal = await getPrincipalFromRequest(request);
  if (!principal) return unauthorized();
  const releaseId = Number(id);
  if (!Number.isInteger(releaseId)) return badRequest("Invalid release id");
  try {
    return Response.json(await listReleaseTasks(principal, releaseId));
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleSetTaskRelease(request: Request, id: string) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();
  const releaseId = Number(id);
  if (!Number.isInteger(releaseId)) return badRequest("Invalid release id");
  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object") return badRequest("Invalid JSON body");
  const { taskId, assign } = payload as Record<string, unknown>;
  if (!Number.isInteger(taskId)) return badRequest("taskId is required");
  try {
    await setTaskRelease(
      session.user.id,
      taskId as number,
      assign === false ? null : releaseId
    );
    return new Response(null, { status: 204 });
  } catch (error) {
    return authzErrorResponse(error);
  }
}
