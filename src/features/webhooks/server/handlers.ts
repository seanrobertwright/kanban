import {
  getSessionFromRequest,
  unauthorized,
} from "@/features/auth/server/session";
import { authzErrorResponse } from "@/features/workspaces/server/authz";
import { createWebhook, deleteWebhook, listWebhooks } from "./repository";

// getSessionFromRequest throughout, never getPrincipalFromRequest — the split
// agent management drew (its handlers comment): infrastructure that aims the
// workspace's event stream at an arbitrary URL is a human decision, and an
// external token must not make it.

function badRequest(message: string) {
  return Response.json({ error: message }, { status: 400 });
}

export async function handleListWebhooks(request: Request, workspaceId: string) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();
  try {
    return Response.json(await listWebhooks(session.user.id, workspaceId));
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleCreateWebhook(
  request: Request,
  workspaceId: string
) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();

  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object")
    return badRequest("Invalid JSON body");

  const { url, events } = payload as Record<string, unknown>;
  if (typeof url !== "string" || url.trim() === "")
    return badRequest("url is required");
  if (
    events !== undefined &&
    (!Array.isArray(events) || !events.every((e) => typeof e === "string"))
  )
    return badRequest("events must be an array of action names");

  try {
    const result = await createWebhook(session.user.id, workspaceId, {
      url: url.trim(),
      events: events as string[] | undefined,
    });
    return Response.json(result, { status: 201 });
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleDeleteWebhook(request: Request, id: string) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();

  const webhookId = Number(id);
  if (!Number.isInteger(webhookId)) return badRequest("Invalid webhook id");

  try {
    return (await deleteWebhook(session.user.id, webhookId))
      ? new Response(null, { status: 204 })
      : Response.json({ error: "Webhook not found" }, { status: 404 });
  } catch (error) {
    return authzErrorResponse(error);
  }
}
