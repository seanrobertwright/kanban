import { getPrincipalFromRequest } from "@/features/auth/server/agent-auth";
import {
  getSessionFromRequest,
  unauthorized,
} from "@/features/auth/server/session";
import { authzErrorResponse } from "@/features/workspaces/server/authz";
import { PROGRAM_NAME_MAX } from "../types";
import {
  createProgram,
  deleteProgram,
  getWorkspacePrograms,
  setBoardProgram,
  updateProgram,
} from "./repository";

function badRequest(message: string) {
  return Response.json({ error: message }, { status: 400 });
}

function notFound(what = "Program") {
  return Response.json({ error: `${what} not found` }, { status: 404 });
}

function readName(body: unknown): string | { error: string } {
  if (!body || typeof body !== "object") return { error: "Invalid JSON body" };
  const { name } = body as Record<string, unknown>;
  if (typeof name !== "string" || !name.trim()) return { error: "name is required" };
  const trimmed = name.trim();
  if (trimmed.length > PROGRAM_NAME_MAX)
    return { error: `name must be ${PROGRAM_NAME_MAX} characters or fewer` };
  return trimmed;
}

export async function handleListPrograms(request: Request, workspaceId: string) {
  // A read (viewer+), so a principal — an agent reasoning across a workspace may
  // read where its initiatives stand, the portfolio read rule.
  const principal = await getPrincipalFromRequest(request);
  if (!principal) return unauthorized();
  try {
    return Response.json(await getWorkspacePrograms(principal, workspaceId));
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleCreateProgram(request: Request, workspaceId: string) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();
  const name = readName(await request.json().catch(() => null));
  if (typeof name !== "string") return badRequest(name.error);
  try {
    return Response.json(
      await createProgram(session.user.id, workspaceId, { name }),
      { status: 201 }
    );
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleUpdateProgram(request: Request, id: string) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();
  const programId = Number(id);
  if (!Number.isInteger(programId)) return badRequest("Invalid program id");
  const name = readName(await request.json().catch(() => null));
  if (typeof name !== "string") return badRequest(name.error);
  try {
    const program = await updateProgram(session.user.id, programId, { name });
    return program ? Response.json(program) : notFound();
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleDeleteProgram(request: Request, id: string) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();
  const programId = Number(id);
  if (!Number.isInteger(programId)) return badRequest("Invalid program id");
  try {
    return (await deleteProgram(session.user.id, programId))
      ? new Response(null, { status: 204 })
      : notFound();
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleAssignBoardProgram(request: Request, id: string) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();
  const boardId = Number(id);
  if (!Number.isInteger(boardId)) return badRequest("Invalid board id");

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return badRequest("Invalid JSON body");
  const { programId } = body as Record<string, unknown>;
  if (programId !== null && !Number.isInteger(programId))
    return badRequest("programId must be a program id or null");

  try {
    await setBoardProgram(session.user.id, boardId, programId as number | null);
    return new Response(null, { status: 204 });
  } catch (error) {
    return authzErrorResponse(error);
  }
}
