import { getPrincipalFromRequest } from "@/features/auth/server/agent-auth";
import { unauthorized } from "@/features/auth/server/session";
import { authzErrorResponse } from "@/features/workspaces/server/authz";
import {
  addDependency,
  getDependencies,
  removeDependency,
} from "./repository";

function badRequest(message: string) {
  return Response.json({ error: message }, { status: 400 });
}

/**
 * getPrincipalFromRequest, not getSessionFromRequest — the whole dependencies
 * slice is agent-capable, the same door the task mutations use. An agent
 * decomposing or sequencing work is exactly who declares "this waits on that",
 * so the door that carries claim/move/update carries this too.
 */
export async function handleGetDependencies(request: Request, taskId: number) {
  const principal = await getPrincipalFromRequest(request);
  if (!principal) return unauthorized();
  if (!Number.isInteger(taskId)) return badRequest("Invalid task id");
  try {
    return Response.json(await getDependencies(principal, taskId));
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleAddDependency(request: Request, taskId: number) {
  const principal = await getPrincipalFromRequest(request);
  if (!principal) return unauthorized();
  if (!Number.isInteger(taskId)) return badRequest("Invalid task id");

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return badRequest("Invalid JSON body");
  const { dependsOnId } = body as Record<string, unknown>;
  if (!Number.isInteger(dependsOnId))
    return badRequest("dependsOnId is required");

  try {
    await addDependency(principal, taskId, dependsOnId as number);
    // 201-less: the edge has no id of its own to return, and the section refetches
    // the whole {dependencies, candidates} pair after a change rather than reading
    // a body here. 204 says "done, nothing to read", which is the truth.
    return new Response(null, { status: 204 });
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleRemoveDependency(
  request: Request,
  taskId: number,
  dependsOnId: number
) {
  const principal = await getPrincipalFromRequest(request);
  if (!principal) return unauthorized();
  if (!Number.isInteger(taskId) || !Number.isInteger(dependsOnId))
    return badRequest("Invalid task id");
  try {
    return (await removeDependency(principal, taskId, dependsOnId))
      ? new Response(null, { status: 204 })
      : Response.json({ error: "Dependency not found" }, { status: 404 });
  } catch (error) {
    return authzErrorResponse(error);
  }
}
