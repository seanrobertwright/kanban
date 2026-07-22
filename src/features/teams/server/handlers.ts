import { getPrincipalFromRequest } from "@/features/auth/server/agent-auth";
import {
  getSessionFromRequest,
  unauthorized,
} from "@/features/auth/server/session";
import { authzErrorResponse } from "@/features/workspaces/server/authz";
import { TEAM_NAME_MAX } from "../types";
import {
  addTeamMember,
  createTeam,
  deleteTeam,
  getScaledAgileOverview,
  removeTeamMember,
  setBoardTeam,
  updateTeam,
} from "./repository";

function badRequest(message: string) {
  return Response.json({ error: message }, { status: 400 });
}

function notFound(what = "Team") {
  return Response.json({ error: `${what} not found` }, { status: 404 });
}

function readName(body: unknown): string | { error: string } {
  if (!body || typeof body !== "object") return { error: "Invalid JSON body" };
  const { name } = body as Record<string, unknown>;
  if (typeof name !== "string" || !name.trim()) return { error: "name is required" };
  const trimmed = name.trim();
  if (trimmed.length > TEAM_NAME_MAX)
    return { error: `name must be ${TEAM_NAME_MAX} characters or fewer` };
  return trimmed;
}

export async function handleScaledAgile(request: Request, workspaceId: string) {
  // A read (viewer+), so a principal — an agent reasoning across a workspace may
  // read how it is organised, the portfolio read rule.
  const principal = await getPrincipalFromRequest(request);
  if (!principal) return unauthorized();
  try {
    return Response.json(await getScaledAgileOverview(principal, workspaceId));
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleCreateTeam(request: Request, workspaceId: string) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();
  const name = readName(await request.json().catch(() => null));
  if (typeof name !== "string") return badRequest(name.error);
  try {
    return Response.json(
      await createTeam(session.user.id, workspaceId, { name }),
      { status: 201 }
    );
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleUpdateTeam(request: Request, id: string) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();
  const teamId = Number(id);
  if (!Number.isInteger(teamId)) return badRequest("Invalid team id");
  const name = readName(await request.json().catch(() => null));
  if (typeof name !== "string") return badRequest(name.error);
  try {
    const team = await updateTeam(session.user.id, teamId, { name });
    return team ? Response.json(team) : notFound();
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleDeleteTeam(request: Request, id: string) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();
  const teamId = Number(id);
  if (!Number.isInteger(teamId)) return badRequest("Invalid team id");
  try {
    return (await deleteTeam(session.user.id, teamId))
      ? new Response(null, { status: 204 })
      : notFound();
  } catch (error) {
    return authzErrorResponse(error);
  }
}

/** Reads a userId string off a body — the shape both member endpoints share. */
function readUserId(body: unknown): string | { error: string } {
  if (!body || typeof body !== "object") return { error: "Invalid JSON body" };
  const { userId } = body as Record<string, unknown>;
  if (typeof userId !== "string" || !userId.trim())
    return { error: "userId is required" };
  return userId;
}

export async function handleAddTeamMember(request: Request, id: string) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();
  const teamId = Number(id);
  if (!Number.isInteger(teamId)) return badRequest("Invalid team id");
  const userId = readUserId(await request.json().catch(() => null));
  if (typeof userId !== "string") return badRequest(userId.error);
  try {
    await addTeamMember(session.user.id, teamId, userId);
    return new Response(null, { status: 204 });
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleRemoveTeamMember(request: Request, id: string) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();
  const teamId = Number(id);
  if (!Number.isInteger(teamId)) return badRequest("Invalid team id");
  const userId = readUserId(await request.json().catch(() => null));
  if (typeof userId !== "string") return badRequest(userId.error);
  try {
    await removeTeamMember(session.user.id, teamId, userId);
    return new Response(null, { status: 204 });
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleAssignBoardTeam(request: Request, id: string) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();
  const boardId = Number(id);
  if (!Number.isInteger(boardId)) return badRequest("Invalid board id");

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return badRequest("Invalid JSON body");
  const { teamId } = body as Record<string, unknown>;
  if (teamId !== null && !Number.isInteger(teamId))
    return badRequest("teamId must be a team id or null");

  try {
    await setBoardTeam(session.user.id, boardId, teamId as number | null);
    return new Response(null, { status: 204 });
  } catch (error) {
    return authzErrorResponse(error);
  }
}
