import { getPrincipalFromRequest } from "@/features/auth/server/agent-auth";
import {
  getSessionFromRequest,
  unauthorized,
} from "@/features/auth/server/session";
import { authzErrorResponse } from "@/features/workspaces/server/authz";
import { ROLE_MAX, WEEKLY_POINTS_MAX } from "../types";
import { getBoardCapacity, setMemberCapacity } from "./repository";

function badRequest(message: string) {
  return Response.json({ error: message }, { status: 400 });
}

export async function handleBoardCapacity(request: Request, id: string) {
  // A read (viewer+), so a principal — the analytics/timesheet read rule.
  const principal = await getPrincipalFromRequest(request);
  if (!principal) return unauthorized();
  const boardId = Number(id);
  if (!Number.isInteger(boardId)) return badRequest("Invalid board id");
  try {
    return Response.json(await getBoardCapacity(principal, boardId));
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleSetMemberCapacity(
  request: Request,
  workspaceId: string,
  userId: string
) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return badRequest("Invalid JSON body");
  const { weeklyPoints, role } = body as Record<string, unknown>;

  if (
    typeof weeklyPoints !== "number" ||
    !Number.isInteger(weeklyPoints) ||
    weeklyPoints < 0 ||
    weeklyPoints > WEEKLY_POINTS_MAX
  )
    return badRequest(`weeklyPoints must be an integer 0–${WEEKLY_POINTS_MAX}`);
  if (typeof role !== "string") return badRequest("role must be a string");
  if (role.trim().length > ROLE_MAX)
    return badRequest(`role must be ${ROLE_MAX} characters or fewer`);

  try {
    return Response.json(
      await setMemberCapacity(session.user.id, workspaceId, userId, {
        weeklyPoints,
        role,
      })
    );
  } catch (error) {
    return authzErrorResponse(error);
  }
}
