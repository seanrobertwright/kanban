import { getPrincipalFromRequest } from "@/features/auth/server/agent-auth";
import {
  getSessionFromRequest,
  unauthorized,
} from "@/features/auth/server/session";
import { authzErrorResponse } from "@/features/workspaces/server/authz";
import {
  ROLE_MAX,
  TIME_OFF_MAX_DAYS,
  TIME_OFF_NOTE_MAX,
  WEEKLY_POINTS_MAX,
} from "../types";
import {
  createTimeOff,
  deleteTimeOff,
  getBoardCapacity,
  setMemberCapacity,
} from "./repository";

function badRequest(message: string) {
  return Response.json({ error: message }, { status: 400 });
}

/**
 * A calendar date, validated by round-trip rather than by regex alone: `2026-02-31`
 * matches the shape but is not a day, and Postgres would refuse it as a 500 from
 * a cast instead of a 400 the caller can act on.
 */
function isIsoDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
  );
}

const DAY_MS = 86_400_000;

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

/** Books an absence (090). A human path only — an agent has no leave to take,
 *  which is the same reasoning that keeps agents out of the capacity roster. */
export async function handleCreateTimeOff(request: Request, workspaceId: string) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return badRequest("Invalid JSON body");
  const { userId, startsOn, endsOn, note } = body as Record<string, unknown>;

  // Omitted userId means "mine" — the common case, and one the client should not
  // have to know its own id to express.
  const target = userId === undefined ? session.user.id : userId;
  if (typeof target !== "string" || target.length === 0)
    return badRequest("userId must be a string");
  if (!isIsoDate(startsOn) || !isIsoDate(endsOn))
    return badRequest("startsOn and endsOn must be YYYY-MM-DD dates");
  if (endsOn < startsOn) return badRequest("endsOn must not precede startsOn");
  const span =
    (Date.parse(`${endsOn}T00:00:00Z`) - Date.parse(`${startsOn}T00:00:00Z`)) /
      DAY_MS +
    1;
  if (span > TIME_OFF_MAX_DAYS)
    return badRequest(`Time off must be ${TIME_OFF_MAX_DAYS} days or fewer`);
  if (note !== undefined && typeof note !== "string")
    return badRequest("note must be a string");
  if (typeof note === "string" && note.trim().length > TIME_OFF_NOTE_MAX)
    return badRequest(`note must be ${TIME_OFF_NOTE_MAX} characters or fewer`);

  try {
    return Response.json(
      await createTimeOff(session.user.id, workspaceId, {
        userId: target,
        startsOn,
        endsOn,
        note: typeof note === "string" ? note : "",
      })
    );
  } catch (error) {
    return authzErrorResponse(error);
  }
}

/** Revokes an absence (own-or-admin, decided in the repository). */
export async function handleDeleteTimeOff(
  request: Request,
  workspaceId: string,
  entryId: string
) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();
  const id = Number(entryId);
  if (!Number.isInteger(id)) return badRequest("Invalid time off id");

  try {
    await deleteTimeOff(session.user.id, workspaceId, id);
    return Response.json({ ok: true });
  } catch (error) {
    return authzErrorResponse(error);
  }
}
