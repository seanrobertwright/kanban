import { getPrincipalFromRequest } from "@/features/auth/server/agent-auth";
import {
  getSessionFromRequest,
  unauthorized,
} from "@/features/auth/server/session";
import { authzErrorResponse } from "@/features/workspaces/server/authz";
import {
  KEY_RESULT_TITLE_MAX,
  OBJECTIVE_NAME_MAX,
  type CreateKeyResultInput,
  type UpdateKeyResultInput,
  type UpdateObjectiveInput,
} from "../types";
import {
  createKeyResult,
  createObjective,
  deleteKeyResult,
  deleteObjective,
  listObjectives,
  updateKeyResult,
  updateObjective,
} from "./repository";

// Reads take a principal (an agent that can read a board can read its
// objectives); management takes a session — the split epic and milestone draw.

function badRequest(message: string) {
  return Response.json({ error: message }, { status: 400 });
}

function notFound(what = "Objective") {
  return Response.json({ error: `${what} not found` }, { status: 404 });
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A due date is absent, null (clear), or a 'YYYY-MM-DD' string. Returns the
 *  parsed value, or the sentinel `false` on a malformed one. */
function readDueDate(
  payload: Record<string, unknown>
): { present: false } | { present: true; value: string | null } | false {
  if (!("dueDate" in payload)) return { present: false };
  const v = payload.dueDate;
  if (v === null) return { present: true, value: null };
  if (typeof v === "string" && DATE_RE.test(v)) return { present: true, value: v };
  return false;
}

export async function handleListObjectives(request: Request, id: string) {
  const principal = await getPrincipalFromRequest(request);
  if (!principal) return unauthorized();
  const boardId = Number(id);
  if (!Number.isInteger(boardId)) return badRequest("Invalid board id");
  try {
    return Response.json(await listObjectives(principal, boardId));
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleCreateObjective(request: Request, id: string) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();
  const boardId = Number(id);
  if (!Number.isInteger(boardId)) return badRequest("Invalid board id");

  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object")
    return badRequest("Invalid JSON body");
  const p = payload as Record<string, unknown>;
  const { name, description } = p;
  if (typeof name !== "string" || name.trim() === "")
    return badRequest("name is required");
  if (name.trim().length > OBJECTIVE_NAME_MAX)
    return badRequest(`name must be ${OBJECTIVE_NAME_MAX} characters or fewer`);
  if (description !== undefined && typeof description !== "string")
    return badRequest("description must be a string");
  const due = readDueDate(p);
  if (due === false) return badRequest("dueDate must be YYYY-MM-DD or null");

  try {
    const objective = await createObjective(
      session.user.id,
      boardId,
      {
        name: name.trim(),
        description: description as string | undefined,
        dueDate: due.present ? due.value : undefined,
      },
      { type: "human", id: session.user.id }
    );
    return Response.json(objective, { status: 201 });
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleUpdateObjective(request: Request, id: string) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();
  const objectiveId = Number(id);
  if (!Number.isInteger(objectiveId)) return badRequest("Invalid objective id");

  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object")
    return badRequest("Invalid JSON body");
  const p = payload as Record<string, unknown>;
  const { name, description } = p;
  if (name !== undefined && (typeof name !== "string" || name.trim() === ""))
    return badRequest("name must be a non-empty string");
  if (description !== undefined && typeof description !== "string")
    return badRequest("description must be a string");
  const due = readDueDate(p);
  if (due === false) return badRequest("dueDate must be YYYY-MM-DD or null");

  const input: UpdateObjectiveInput = {
    name: name as string | undefined,
    description: description as string | undefined,
  };
  if (due.present) input.dueDate = due.value;

  try {
    const objective = await updateObjective(session.user.id, objectiveId, input, {
      type: "human",
      id: session.user.id,
    });
    return objective ? Response.json(objective) : notFound();
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleDeleteObjective(request: Request, id: string) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();
  const objectiveId = Number(id);
  if (!Number.isInteger(objectiveId)) return badRequest("Invalid objective id");

  try {
    return (await deleteObjective(session.user.id, objectiveId, {
      type: "human",
      id: session.user.id,
    }))
      ? new Response(null, { status: 204 })
      : notFound();
  } catch (error) {
    return authzErrorResponse(error);
  }
}

/** A finite number, or the sentinel `false` — rejects NaN/Infinity/non-numbers. */
function readNumber(v: unknown): number | false {
  return typeof v === "number" && Number.isFinite(v) ? v : false;
}

export async function handleCreateKeyResult(request: Request, id: string) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();
  const objectiveId = Number(id);
  if (!Number.isInteger(objectiveId)) return badRequest("Invalid objective id");

  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object")
    return badRequest("Invalid JSON body");
  const p = payload as Record<string, unknown>;
  if (typeof p.title !== "string" || p.title.trim() === "")
    return badRequest("title is required");
  if (p.title.trim().length > KEY_RESULT_TITLE_MAX)
    return badRequest(`title must be ${KEY_RESULT_TITLE_MAX} characters or fewer`);
  const target = readNumber(p.targetValue);
  if (target === false) return badRequest("targetValue must be a number");

  const input: CreateKeyResultInput = { title: p.title.trim(), targetValue: target };
  if (p.startValue !== undefined) {
    const start = readNumber(p.startValue);
    if (start === false) return badRequest("startValue must be a number");
    input.startValue = start;
  }
  if (p.currentValue !== undefined) {
    const current = readNumber(p.currentValue);
    if (current === false) return badRequest("currentValue must be a number");
    input.currentValue = current;
  }
  if (p.unit !== undefined) {
    if (typeof p.unit !== "string") return badRequest("unit must be a string");
    input.unit = p.unit;
  }

  try {
    return Response.json(
      await createKeyResult(session.user.id, objectiveId, input),
      { status: 201 }
    );
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleUpdateKeyResult(request: Request, id: string) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();
  const keyResultId = Number(id);
  if (!Number.isInteger(keyResultId)) return badRequest("Invalid key result id");

  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object")
    return badRequest("Invalid JSON body");
  const p = payload as Record<string, unknown>;

  const input: UpdateKeyResultInput = {};
  if (p.title !== undefined) {
    if (typeof p.title !== "string" || p.title.trim() === "")
      return badRequest("title must be a non-empty string");
    input.title = p.title.trim();
  }
  for (const key of ["startValue", "targetValue", "currentValue", "position"] as const) {
    if (p[key] !== undefined) {
      const n = readNumber(p[key]);
      if (n === false) return badRequest(`${key} must be a number`);
      input[key] = n;
    }
  }
  if (p.unit !== undefined) {
    if (typeof p.unit !== "string") return badRequest("unit must be a string");
    input.unit = p.unit;
  }

  try {
    return Response.json(await updateKeyResult(session.user.id, keyResultId, input));
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleDeleteKeyResult(request: Request, id: string) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();
  const keyResultId = Number(id);
  if (!Number.isInteger(keyResultId)) return badRequest("Invalid key result id");

  try {
    return Response.json(await deleteKeyResult(session.user.id, keyResultId));
  } catch (error) {
    return authzErrorResponse(error);
  }
}
