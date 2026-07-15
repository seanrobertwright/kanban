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

function badRequest(message: string) {
  return Response.json({ error: message }, { status: 400 });
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
