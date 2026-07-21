import { getPrincipalFromRequest } from "@/features/auth/server/agent-auth";
import {
  getSessionFromRequest,
  unauthorized,
} from "@/features/auth/server/session";
import { authzErrorResponse } from "@/features/workspaces/server/authz";
import {
  createMilestone,
  deleteMilestone,
  listMilestones,
  updateMilestone,
} from "./repository";

// Reads take a principal (an agent that can read a board can read its
// targets); management takes a session — the columns split, drawn here too.

function badRequest(message: string) {
  return Response.json({ error: message }, { status: 400 });
}

function notFound() {
  return Response.json({ error: "Milestone not found" }, { status: 404 });
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isDueDate(value: unknown): value is string | null | undefined {
  return (
    value === undefined ||
    value === null ||
    (typeof value === "string" && ISO_DATE.test(value))
  );
}

export async function handleListMilestones(request: Request, id: string) {
  const principal = await getPrincipalFromRequest(request);
  if (!principal) return unauthorized();
  const boardId = Number(id);
  if (!Number.isInteger(boardId)) return badRequest("Invalid board id");
  try {
    return Response.json(await listMilestones(principal, boardId));
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleCreateMilestone(request: Request, id: string) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();
  const boardId = Number(id);
  if (!Number.isInteger(boardId)) return badRequest("Invalid board id");

  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object")
    return badRequest("Invalid JSON body");
  const { name, dueDate, epicId, objectiveId } = payload as Record<string, unknown>;
  if (typeof name !== "string" || name.trim() === "")
    return badRequest("name is required");
  if (!isDueDate(dueDate))
    return badRequest("dueDate must be a YYYY-MM-DD date or null");
  if (epicId !== undefined && epicId !== null && !Number.isInteger(epicId))
    return badRequest("epicId must be an epic id or null");
  if (objectiveId !== undefined && objectiveId !== null && !Number.isInteger(objectiveId))
    return badRequest("objectiveId must be an objective id or null");

  try {
    const milestone = await createMilestone(
      session.user.id,
      boardId,
      {
        name: name.trim(),
        dueDate: (dueDate as string | null) ?? null,
        epicId: epicId as number | null | undefined,
        objectiveId: objectiveId as number | null | undefined,
      },
      { type: "human", id: session.user.id }
    );
    return Response.json(milestone, { status: 201 });
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleUpdateMilestone(request: Request, id: string) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();
  const milestoneId = Number(id);
  if (!Number.isInteger(milestoneId)) return badRequest("Invalid milestone id");

  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object")
    return badRequest("Invalid JSON body");
  const { name, dueDate, epicId, objectiveId } = payload as Record<string, unknown>;
  if (name !== undefined && (typeof name !== "string" || name.trim() === ""))
    return badRequest("name must be a non-empty string");
  if (!isDueDate(dueDate))
    return badRequest("dueDate must be a YYYY-MM-DD date or null");
  if (epicId !== undefined && epicId !== null && !Number.isInteger(epicId))
    return badRequest("epicId must be an epic id or null");
  if (objectiveId !== undefined && objectiveId !== null && !Number.isInteger(objectiveId))
    return badRequest("objectiveId must be an objective id or null");
  const setsDueDate = "dueDate" in payload;
  const setsEpic = "epicId" in payload;
  const setsObjective = "objectiveId" in payload;

  try {
    const milestone = await updateMilestone(
      session.user.id,
      milestoneId,
      {
        name: name as string | undefined,
        ...(setsDueDate ? { dueDate: dueDate as string | null } : {}),
        ...(setsEpic ? { epicId: epicId as number | null } : {}),
        ...(setsObjective ? { objectiveId: objectiveId as number | null } : {}),
      },
      { type: "human", id: session.user.id }
    );
    return milestone ? Response.json(milestone) : notFound();
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleDeleteMilestone(request: Request, id: string) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();
  const milestoneId = Number(id);
  if (!Number.isInteger(milestoneId)) return badRequest("Invalid milestone id");

  try {
    return (await deleteMilestone(session.user.id, milestoneId, {
      type: "human",
      id: session.user.id,
    }))
      ? new Response(null, { status: 204 })
      : notFound();
  } catch (error) {
    return authzErrorResponse(error);
  }
}
