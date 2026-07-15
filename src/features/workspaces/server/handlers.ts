import {
  getSessionFromRequest,
  unauthorized,
} from "@/features/auth/server/session";
import { authzErrorResponse } from "./authz";
import {
  inviteMember,
  isWorkspaceRole,
  listInvitations,
  listMembers,
  removeMember,
  revokeInvitation,
  updateMemberRole,
} from "./members";
import { createBoard, createWorkspace } from "./repository";

function badRequest(message: string) {
  return Response.json({ error: message }, { status: 400 });
}

const NAME_MAX = 60;

/**
 * Names are the one free-text field on these two routes. Trim first, then
 * length-check the trimmed value, so "   " is rejected as empty rather than
 * stored as whitespace.
 */
function readName(body: unknown): string | { error: string } {
  if (!body || typeof body !== "object") return { error: "Invalid JSON body" };
  const { name } = body as Record<string, unknown>;
  if (typeof name !== "string" || !name.trim())
    return { error: "name is required" };
  const trimmed = name.trim();
  if (trimmed.length > NAME_MAX)
    return { error: `name must be ${NAME_MAX} characters or fewer` };
  return trimmed;
}

export async function handleCreateWorkspace(request: Request) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();

  const name = readName(await request.json().catch(() => null));
  if (typeof name !== "string") return badRequest(name.error);

  // No try/catch for authz: createWorkspace has no role to check — the session
  // above is the whole gate. A throw here is a real fault and should 500.
  const workspace = await createWorkspace(session.user.id, name);
  return Response.json(workspace, { status: 201 });
}

export async function handleCreateBoard(request: Request, workspaceId: string) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();

  const name = readName(await request.json().catch(() => null));
  if (typeof name !== "string") return badRequest(name.error);

  try {
    const board = await createBoard(session.user.id, workspaceId, name);
    return Response.json(board, { status: 201 });
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleListMembers(request: Request, workspaceId: string) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();
  try {
    const [members, invitations] = await Promise.all([
      listMembers(session.user.id, workspaceId),
      // Only admins may see pending invites; members still get their roster.
      listInvitations(session.user.id, workspaceId).catch(() => []),
    ]);
    return Response.json({ members, invitations });
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleInvite(request: Request, workspaceId: string) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return badRequest("Invalid JSON body");

  const { email, role } = body as Record<string, unknown>;
  if (typeof email !== "string" || !email.trim())
    return badRequest("email is required");
  if (!isWorkspaceRole(role)) return badRequest("role is invalid");

  try {
    const invitation = await inviteMember(session.user.id, workspaceId, email, role);
    return Response.json(invitation, { status: 201 });
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleRevokeInvitation(request: Request, id: string) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();
  try {
    await revokeInvitation(session.user.id, id);
    return new Response(null, { status: 204 });
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleUpdateMember(
  request: Request,
  workspaceId: string,
  userId: string
) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return badRequest("Invalid JSON body");

  const { role } = body as Record<string, unknown>;
  if (!isWorkspaceRole(role)) return badRequest("role is invalid");

  try {
    const member = await updateMemberRole(
      session.user.id,
      workspaceId,
      userId,
      role
    );
    return Response.json(member);
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleRemoveMember(
  request: Request,
  workspaceId: string,
  userId: string
) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();
  try {
    await removeMember(session.user.id, workspaceId, userId);
    return new Response(null, { status: 204 });
  } catch (error) {
    return authzErrorResponse(error);
  }
}
