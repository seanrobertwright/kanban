import { getPrincipalFromRequest } from "@/features/auth/server/agent-auth";
import {
  getSessionFromRequest,
  unauthorized,
} from "@/features/auth/server/session";
import { authzErrorResponse } from "@/features/workspaces/server/authz";
import {
  completeSprint,
  createSprint,
  deleteSprint,
  getBoardSprintCapacity,
  listSprints,
  startSprint,
  updateSprint,
} from "./repository";

// Reads take a principal (an agent planning against a task may read the
// board's sprints); writes take a session — sprint planning is a human act.

function badRequest(message: string) {
  return Response.json({ error: message }, { status: 400 });
}

function notFound() {
  return Response.json({ error: "Sprint not found" }, { status: 404 });
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isDate(value: unknown): value is string | null | undefined {
  return (
    value === undefined ||
    value === null ||
    (typeof value === "string" && ISO_DATE.test(value))
  );
}

export async function handleListSprints(request: Request, id: string) {
  const principal = await getPrincipalFromRequest(request);
  if (!principal) return unauthorized();
  const boardId = Number(id);
  if (!Number.isInteger(boardId)) return badRequest("Invalid board id");
  try {
    // The list and the capacity breakdown together — the planning dialog wants
    // both, and one round trip beats two.
    const [sprints, capacity] = await Promise.all([
      listSprints(principal, boardId),
      getBoardSprintCapacity(principal, boardId),
    ]);
    return Response.json({ sprints, capacity });
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleCreateSprint(request: Request, id: string) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();
  const boardId = Number(id);
  if (!Number.isInteger(boardId)) return badRequest("Invalid board id");

  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object")
    return badRequest("Invalid JSON body");
  const { name, goal, startDate, endDate } = payload as Record<string, unknown>;
  if (typeof name !== "string" || name.trim() === "")
    return badRequest("name is required");
  if (goal !== undefined && typeof goal !== "string")
    return badRequest("goal must be a string");
  if (!isDate(startDate) || !isDate(endDate))
    return badRequest("dates must be YYYY-MM-DD or null");

  try {
    const sprint = await createSprint(
      session.user.id,
      boardId,
      {
        name: name.trim(),
        goal: goal as string | undefined,
        startDate: (startDate as string | null) ?? null,
        endDate: (endDate as string | null) ?? null,
      },
      { type: "human", id: session.user.id }
    );
    return Response.json(sprint, { status: 201 });
  } catch (error) {
    return authzErrorResponse(error);
  }
}

/**
 * One PATCH, three intents behind an `action` discriminator: a field edit
 * (name/goal/dates), or a lifecycle transition `start` / `complete`. They are
 * exclusive — a request mixing an edit with a transition is refused, so it is
 * never ambiguous which rule (and which log action) applies.
 */
export async function handleUpdateSprint(request: Request, id: string) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();
  const sprintId = Number(id);
  if (!Number.isInteger(sprintId)) return badRequest("Invalid sprint id");

  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object")
    return badRequest("Invalid JSON body");
  const by = { type: "human" as const, id: session.user.id };
  const { action, name, goal, startDate, endDate, rolloverToSprintId } =
    payload as Record<string, unknown>;

  try {
    if (action === "start") {
      const sprint = await startSprint(session.user.id, sprintId, by);
      return sprint ? Response.json(sprint) : notFound();
    }
    if (action === "complete") {
      if (
        rolloverToSprintId !== undefined &&
        rolloverToSprintId !== null &&
        !Number.isInteger(rolloverToSprintId)
      )
        return badRequest("rolloverToSprintId must be a sprint id or null");
      const sprint = await completeSprint(
        session.user.id,
        sprintId,
        (rolloverToSprintId as number | null | undefined) ?? null,
        by
      );
      return sprint ? Response.json(sprint) : notFound();
    }
    if (action !== undefined)
      return badRequest("action must be 'start' or 'complete'");

    // A field edit.
    if (name !== undefined && (typeof name !== "string" || name.trim() === ""))
      return badRequest("name must be a non-empty string");
    if (goal !== undefined && typeof goal !== "string")
      return badRequest("goal must be a string");
    if (!isDate(startDate) || !isDate(endDate))
      return badRequest("dates must be YYYY-MM-DD or null");
    const setsStart = "startDate" in payload;
    const setsEnd = "endDate" in payload;

    const sprint = await updateSprint(
      session.user.id,
      sprintId,
      {
        name: name as string | undefined,
        goal: goal as string | undefined,
        ...(setsStart ? { startDate: startDate as string | null } : {}),
        ...(setsEnd ? { endDate: endDate as string | null } : {}),
      },
      by
    );
    return sprint ? Response.json(sprint) : notFound();
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleDeleteSprint(request: Request, id: string) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();
  const sprintId = Number(id);
  if (!Number.isInteger(sprintId)) return badRequest("Invalid sprint id");
  try {
    return (await deleteSprint(session.user.id, sprintId, {
      type: "human",
      id: session.user.id,
    }))
      ? new Response(null, { status: 204 })
      : notFound();
  } catch (error) {
    return authzErrorResponse(error);
  }
}
