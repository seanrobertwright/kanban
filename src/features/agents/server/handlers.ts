import { getPrincipalFromRequest } from "@/features/auth/server/agent-auth";
import { unauthorized } from "@/features/auth/server/session";
import { authzErrorResponse } from "@/features/workspaces/server/authz";
import { startRunForTask } from "./runtime";
import {
  getLatestRunForTask,
  getRunDetail,
  reviewChangeset,
  revertAction,
} from "./review";
import { listAssignees } from "./roster";

function badRequest(message: string) {
  return Response.json({ error: message }, { status: 400 });
}

/**
 * Start a run on demand for a task already assigned to a native agent — the
 * re-run path, distinct from the automatic trigger on assignment (updateTask).
 * The principal must be a workspace member; startRunForTask enforces that and the
 * "is a native agent" and budget checks, surfacing each as the right status
 * through authzErrorResponse.
 */
export async function handleStartRun(request: Request) {
  const principal = await getPrincipalFromRequest(request);
  if (!principal) return unauthorized();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest("Expected a JSON body with a taskId");
  }
  const taskId = (body as { taskId?: unknown })?.taskId;
  if (!Number.isInteger(taskId)) return badRequest("taskId must be an integer");

  try {
    const runId = await startRunForTask(principal, taskId as number);
    return Response.json({ runId, status: "queued" }, { status: 202 });
  } catch (error) {
    return authzErrorResponse(error);
  }
}

/** GET /api/workspaces/:id/assignees — the email-free roster (people + agents)
 *  an agent can hand a task to. Agent-capable, viewer+. */
export async function handleListAssignees(request: Request, workspaceId: string) {
  const principal = await getPrincipalFromRequest(request);
  if (!principal) return unauthorized();
  try {
    return Response.json(await listAssignees(principal, workspaceId));
  } catch (error) {
    return authzErrorResponse(error);
  }
}

/** GET /api/agents/runs?taskId=N — the latest run for a task (or null), so the
 *  task dialog can show a review panel without knowing a run id up front. */
export async function handleLatestRunForTask(request: Request) {
  const principal = await getPrincipalFromRequest(request);
  if (!principal) return unauthorized();
  const taskId = Number(new URL(request.url).searchParams.get("taskId"));
  if (!Number.isInteger(taskId)) return badRequest("taskId must be an integer");
  try {
    return Response.json(await getLatestRunForTask(principal, taskId));
  } catch (error) {
    return authzErrorResponse(error);
  }
}

/** GET /api/agents/runs/:id — the run, its action trail, and pending changeset,
 *  for the review panel. */
export async function handleGetRun(request: Request, runId: string) {
  const principal = await getPrincipalFromRequest(request);
  if (!principal) return unauthorized();
  try {
    const detail = await getRunDetail(principal, runId);
    return detail
      ? Response.json(detail)
      : Response.json({ error: "Run not found" }, { status: 404 });
  } catch (error) {
    return authzErrorResponse(error);
  }
}

/** POST /api/agents/changesets/:id — accept some/all/none of a changeset.
 *  Body: { accept: string[] } (the agent_action ids to apply). */
export async function handleReviewChangeset(request: Request, changesetId: string) {
  const principal = await getPrincipalFromRequest(request);
  if (!principal) return unauthorized();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest("Expected a JSON body with an accept array");
  }
  const accept = (body as { accept?: unknown })?.accept;
  if (!Array.isArray(accept) || !accept.every((x) => typeof x === "string")) {
    return badRequest("accept must be an array of action ids");
  }

  try {
    const detail = await reviewChangeset(principal, changesetId, accept as string[]);
    return Response.json(detail);
  } catch (error) {
    return authzErrorResponse(error);
  }
}

/** POST /api/agents/actions/:id/revert — undo one auto-tier action. */
export async function handleRevertAction(request: Request, actionId: string) {
  const principal = await getPrincipalFromRequest(request);
  if (!principal) return unauthorized();
  try {
    await revertAction(principal, actionId);
    return new Response(null, { status: 204 });
  } catch (error) {
    return authzErrorResponse(error);
  }
}
