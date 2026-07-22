import { getPrincipalFromRequest } from "@/features/auth/server/agent-auth";
import {
  getSessionFromRequest,
  unauthorized,
} from "@/features/auth/server/session";
import { authzErrorResponse } from "@/features/workspaces/server/authz";
import type { CreateSlaPolicyInput, UpdateSlaPolicyInput } from "../types";
import {
  createSlaPolicy,
  deleteSlaPolicy,
  listSlaPolicies,
  taskSlaStatus,
  updateSlaPolicy,
} from "./repository";

function badRequest(message: string) {
  return Response.json({ error: message }, { status: 400 });
}
function notFound() {
  return Response.json({ error: "SLA policy not found" }, { status: 404 });
}

export async function handleListSlaPolicies(request: Request, id: string) {
  const principal = await getPrincipalFromRequest(request);
  if (!principal) return unauthorized();
  const boardId = Number(id);
  if (!Number.isInteger(boardId)) return badRequest("Invalid board id");
  try {
    return Response.json(await listSlaPolicies(principal, boardId));
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleCreateSlaPolicy(request: Request, id: string) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();
  const boardId = Number(id);
  if (!Number.isInteger(boardId)) return badRequest("Invalid board id");
  const p = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!p) return badRequest("Invalid JSON body");
  if (typeof p.name !== "string" || p.name.trim() === "") return badRequest("name is required");
  if (!Number.isInteger(p.targetMins) || (p.targetMins as number) <= 0)
    return badRequest("targetMins must be a positive integer");
  const input: CreateSlaPolicyInput = {
    name: p.name.trim(),
    targetMins: p.targetMins as number,
    appliesWhen: p.appliesWhen as CreateSlaPolicyInput["appliesWhen"],
    actionOnBreach: p.actionOnBreach as CreateSlaPolicyInput["actionOnBreach"],
    isEnabled: p.isEnabled as boolean | undefined,
  };
  try {
    return Response.json(await createSlaPolicy(session.user.id, boardId, input), {
      status: 201,
    });
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleUpdateSlaPolicy(request: Request, id: string) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();
  const policyId = Number(id);
  if (!Number.isInteger(policyId)) return badRequest("Invalid policy id");
  const p = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!p) return badRequest("Invalid JSON body");
  if (p.targetMins !== undefined && (!Number.isInteger(p.targetMins) || (p.targetMins as number) <= 0))
    return badRequest("targetMins must be a positive integer");
  const input: UpdateSlaPolicyInput = {
    name: p.name as string | undefined,
    targetMins: p.targetMins as number | undefined,
    appliesWhen: p.appliesWhen as UpdateSlaPolicyInput["appliesWhen"],
    actionOnBreach: p.actionOnBreach as UpdateSlaPolicyInput["actionOnBreach"],
    isEnabled: p.isEnabled as boolean | undefined,
  };
  try {
    const policy = await updateSlaPolicy(session.user.id, policyId, input);
    return policy ? Response.json(policy) : notFound();
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleDeleteSlaPolicy(request: Request, id: string) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();
  const policyId = Number(id);
  if (!Number.isInteger(policyId)) return badRequest("Invalid policy id");
  try {
    return (await deleteSlaPolicy(session.user.id, policyId))
      ? new Response(null, { status: 204 })
      : notFound();
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleTaskSla(request: Request, id: string) {
  const principal = await getPrincipalFromRequest(request);
  if (!principal) return unauthorized();
  const taskId = Number(id);
  if (!Number.isInteger(taskId)) return badRequest("Invalid task id");
  try {
    return Response.json(await taskSlaStatus(principal, taskId));
  } catch (error) {
    return authzErrorResponse(error);
  }
}
