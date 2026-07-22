import { getPrincipalFromRequest } from "@/features/auth/server/agent-auth";
import {
  getSessionFromRequest,
  unauthorized,
} from "@/features/auth/server/session";
import { authzErrorResponse } from "@/features/workspaces/server/authz";
import {
  createConnection,
  deleteConnection,
  listConnections,
  listTaskGitLinks,
} from "./repository";

/**
 * Git connection management (2.0). Reads of a task's links take a principal (an
 * agent that can read a board can see what delivers its tasks); connection
 * management takes a human session and the repository gates it to admin — the
 * webhooks split, an external token must not aim the integration.
 */

function badRequest(message: string) {
  return Response.json({ error: message }, { status: 400 });
}
function notFound(what = "Connection") {
  return Response.json({ error: `${what} not found` }, { status: 404 });
}

export async function handleListConnections(request: Request, id: string) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();
  try {
    return Response.json(await listConnections(session.user.id, id));
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleCreateConnection(request: Request, id: string) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();
  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object") return badRequest("Invalid JSON body");
  const p = payload as Record<string, unknown>;
  try {
    return Response.json(
      await createConnection(session.user.id, id, {
        provider: p.provider,
        externalRepo: typeof p.externalRepo === "string" ? p.externalRepo : undefined,
        installId: typeof p.installId === "string" ? p.installId : undefined,
      }),
      { status: 201 }
    );
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleDeleteConnection(request: Request, id: string) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();
  const connectionId = Number(id);
  if (!Number.isInteger(connectionId)) return badRequest("Invalid connection id");
  try {
    return (await deleteConnection(session.user.id, connectionId))
      ? new Response(null, { status: 204 })
      : notFound();
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleListTaskGitLinks(request: Request, id: string) {
  const principal = await getPrincipalFromRequest(request);
  if (!principal) return unauthorized();
  const taskId = Number(id);
  if (!Number.isInteger(taskId)) return badRequest("Invalid task id");
  try {
    return Response.json(await listTaskGitLinks(principal, taskId));
  } catch (error) {
    return authzErrorResponse(error);
  }
}
