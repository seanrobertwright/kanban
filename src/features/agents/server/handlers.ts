import { getPrincipalFromRequest } from "@/features/auth/server/agent-auth";
import {
  getSessionFromRequest,
  unauthorized,
} from "@/features/auth/server/session";
import { authzErrorResponse } from "@/features/workspaces/server/authz";
import { isWorkspaceRole } from "@/features/workspaces/server/members";
import { startRunForTask } from "./runtime";
import {
  getLatestRunForTask,
  getRunDetail,
  reviewChangeset,
  revertAction,
} from "./review";
import { createAgent, deleteAgent, listAgents } from "./admin";
import { getBudgetFor, setBudget } from "./budget";
import { listAssignees } from "./roster";
import type { AgentKind, NewAgentInput } from "../types";

function badRequest(message: string) {
  return Response.json({ error: message }, { status: 400 });
}

const AGENT_NAME_MAX = 60;

/** Whether a value is one of §8's two agent kinds — the client's discriminator. */
function isAgentKind(value: unknown): value is AgentKind {
  return value === "native" || value === "external";
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

/*
 * The management surface below is human-only — it resolves the caller by SESSION,
 * not getPrincipalFromRequest. An agent must not be able to mint or retire other
 * agents with its own key: that would let a compromised external token breed
 * principals or delete its peers. Provisioning is an admin-in-a-browser action,
 * so the session is the gate, exactly as the members handlers do it.
 */

/** GET /api/workspaces/:id/agents — the workspace's agents, admin-only. */
export async function handleListAgents(request: Request, workspaceId: string) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();
  try {
    return Response.json(await listAgents(session.user.id, workspaceId));
  } catch (error) {
    return authzErrorResponse(error);
  }
}

/** POST /api/workspaces/:id/agents — mint an agent. The external kind's token is
 *  in the response body once and never again. */
export async function handleCreateAgent(request: Request, workspaceId: string) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return badRequest("Invalid JSON body");
  const { name, role, kind, image, model, systemPrompt } = body as Record<
    string,
    unknown
  >;

  if (typeof name !== "string" || !name.trim())
    return badRequest("name is required");
  if (name.trim().length > AGENT_NAME_MAX)
    return badRequest(`name must be ${AGENT_NAME_MAX} characters or fewer`);
  if (!isWorkspaceRole(role)) return badRequest("role is invalid");
  if (!isAgentKind(kind)) return badRequest("kind must be native or external");
  // A native agent runs a model; the 012 CHECK enforces it, but a clean 400 here
  // beats a constraint-violation 500. External agents ignore the field.
  if (kind === "native" && (typeof model !== "string" || !model.trim()))
    return badRequest("A native agent needs a model (e.g. claude-opus-4-8)");
  if (image != null && typeof image !== "string")
    return badRequest("image must be a string or null");
  if (systemPrompt != null && typeof systemPrompt !== "string")
    return badRequest("systemPrompt must be a string");

  const input: NewAgentInput = {
    name: name.trim(),
    role,
    kind,
    image: typeof image === "string" ? image.trim() || null : null,
    model: kind === "native" ? (model as string).trim() : null,
    systemPrompt:
      kind === "native" && typeof systemPrompt === "string"
        ? systemPrompt
        : null,
  };

  try {
    const created = await createAgent(session.user.id, workspaceId, input);
    return Response.json(created, { status: 201 });
  } catch (error) {
    return authzErrorResponse(error);
  }
}

/** DELETE /api/workspaces/:id/agents/:agentId — retire an agent. */
export async function handleDeleteAgent(
  request: Request,
  workspaceId: string,
  agentId: string
) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();
  try {
    await deleteAgent(session.user.id, workspaceId, agentId);
    return new Response(null, { status: 204 });
  } catch (error) {
    return authzErrorResponse(error);
  }
}

/** GET /api/workspaces/:id/budget — the cap and month-to-date spend, admin-only. */
export async function handleGetBudget(request: Request, workspaceId: string) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();
  try {
    return Response.json(await getBudgetFor(session.user.id, workspaceId));
  } catch (error) {
    return authzErrorResponse(error);
  }
}

/** PUT /api/workspaces/:id/budget — set or clear the cap. Body:
 *  { capMicros: number | null }, micro-dollars, null = uncapped. */
export async function handleSetBudget(request: Request, workspaceId: string) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return badRequest("Invalid JSON body");
  const { capMicros } = body as Record<string, unknown>;

  if (capMicros !== null) {
    if (typeof capMicros !== "number" || !Number.isInteger(capMicros) || capMicros < 0)
      return badRequest("capMicros must be a non-negative integer or null");
  }

  try {
    return Response.json(
      await setBudget(session.user.id, workspaceId, capMicros as number | null)
    );
  } catch (error) {
    return authzErrorResponse(error);
  }
}
