import {
  getSessionFromRequest,
  unauthorized,
} from "@/features/auth/server/session";
import { authzErrorResponse } from "@/features/workspaces/server/authz";
import { listDeliveries } from "./dispatch";
import {
  createWebhook,
  deleteWebhook,
  listWebhooks,
  updateWebhook,
} from "./repository";

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

export async function handleUpdateWebhook(request: Request, id: string) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();

  const webhookId = Number(id);
  if (!Number.isInteger(webhookId)) return badRequest("Invalid webhook id");

  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object")
    return badRequest("Invalid JSON body");

  const { url, events, active, rotateSecret } = payload as Record<string, unknown>;
  if (url !== undefined && (typeof url !== "string" || url.trim() === ""))
    return badRequest("url must be a non-empty string");
  if (
    events !== undefined &&
    (!Array.isArray(events) || !events.every((e) => typeof e === "string"))
  )
    return badRequest("events must be an array of action names");
  if (active !== undefined && typeof active !== "boolean")
    return badRequest("active must be a boolean");
  if (rotateSecret !== undefined && typeof rotateSecret !== "boolean")
    return badRequest("rotateSecret must be a boolean");

  try {
    const result = await updateWebhook(session.user.id, webhookId, {
      url: url === undefined ? undefined : (url as string).trim(),
      events: events as string[] | undefined,
      active: active as boolean | undefined,
      rotateSecret: rotateSecret as boolean | undefined,
    });
    return result
      ? Response.json(result)
      : Response.json({ error: "Webhook not found" }, { status: 404 });
  } catch (error) {
    return authzErrorResponse(error);
  }
}

/**
 * A webhook's delivery history (082). Admin-gated through the repository's own
 * ownership check rather than a second one here — updateWebhook resolves the
 * workspace from the row, and this borrows it so the two cannot drift.
 */
export async function handleListDeliveries(request: Request, id: string) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();

  const webhookId = Number(id);
  if (!Number.isInteger(webhookId)) return badRequest("Invalid webhook id");

  try {
    // A no-op update: it proves the row exists and that this caller is an admin
    // of its workspace, and returns nothing a plain read would not.
    const owner = await updateWebhook(session.user.id, webhookId, {});
    if (!owner) return Response.json({ error: "Webhook not found" }, { status: 404 });
    return Response.json(await listDeliveries(webhookId));
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
