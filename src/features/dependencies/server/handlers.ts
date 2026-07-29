import { getPrincipalFromRequest } from "@/features/auth/server/agent-auth";
import { unauthorized } from "@/features/auth/server/session";
import { authzErrorResponse } from "@/features/workspaces/server/authz";
import { gated } from "@/features/agents/server/door2";
import {
  addDependency,
  getDependencies,
  removeDependency,
} from "./repository";
import {
  DEFAULT_LINK,
  DEPENDENCY_TYPES,
  isDependencyType,
  isLagDays,
  LAG_DAYS_MAX,
  LAG_DAYS_MIN,
  type DependencyType,
} from "../types";

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
  const { dependsOnId, type, lagDays } = body as Record<string, unknown>;
  if (!Number.isInteger(dependsOnId))
    return badRequest("dependsOnId is required");

  // Both optional (087): an omitted field means DEFAULT_LINK, which is the edge
  // every caller wrote before the columns existed. A field that is *present* and
  // wrong is a 400 rather than a silent fallback — a caller that meant SS and
  // typo'd it must not be told the FS edge it did not ask for was created.
  if (type !== undefined && !isDependencyType(type))
    return badRequest(`type must be one of ${DEPENDENCY_TYPES.join(", ")}`);
  if (lagDays !== undefined && !isLagDays(lagDays))
    return badRequest(
      `lagDays must be a whole number of days between ${LAG_DAYS_MIN} and ${LAG_DAYS_MAX}`
    );
  const link = {
    type: type === undefined ? DEFAULT_LINK.type : (type as DependencyType),
    lagDays: lagDays === undefined ? DEFAULT_LINK.lagDays : (lagDays as number),
  };

  try {
    // Door-2 gate (§7.4): flag_blocker, auto by blast radius — silent,
    // idempotent, reversible by removal — so an agent's edge still lands now and
    // is recorded as an action a human can see and undo.
    return await gated(
      principal,
      {
        tool: "flag_blocker",
        // The link rides in the recorded input, not just the two ids: what an
        // agent proposed has to be reviewable, and "blocked by #42" and "starts
        // with #42, two days in" are different proposals.
        input: { taskId, dependsOnId, ...link },
        taskId,
        execute: () =>
          addDependency(principal, taskId, dependsOnId as number, link),
      },
      // 201-less: the edge has no id of its own to return, and the section
      // refetches the whole {dependencies, candidates} pair after a change rather
      // than reading a body here. 204 says "done, nothing to read".
      () => new Response(null, { status: 204 })
    );
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
    // The inverse of flag_blocker, and named because an unnamed tool falls
    // through tierFor to 'changeset' — which would have held an agent's edge
    // removal for review while its edge creation ran free. Auto for the same
    // reason its twin is: reversible by re-adding, and nothing outside the board
    // hears about it.
    return await gated(
      principal,
      {
        tool: "unflag_blocker",
        input: { taskId, dependsOnId },
        taskId,
        execute: () => removeDependency(principal, taskId, dependsOnId),
      },
      (removed) =>
        removed
          ? new Response(null, { status: 204 })
          : Response.json({ error: "Dependency not found" }, { status: 404 })
    );
  } catch (error) {
    return authzErrorResponse(error);
  }
}
