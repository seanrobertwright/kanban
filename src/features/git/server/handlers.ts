import { getPrincipalFromRequest } from "@/features/auth/server/agent-auth";
import {
  getSessionFromRequest,
  unauthorized,
} from "@/features/auth/server/session";
import { authzErrorResponse } from "@/features/workspaces/server/authz";
import {
  connectionForIngress,
  createConnection,
  deleteConnection,
  ingestEvent,
  listConnections,
  listTaskGitLinks,
} from "./repository";
import { normalizeGithubEvent, verifyGithubSignature } from "./github";
import { normalizeGitlabEvent, verifyGitlabToken } from "./gitlab";
import {
  normalizeBitbucketEvent,
  verifyBitbucketSignature,
} from "./bitbucket";

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

/**
 * The GitHub webhook ingress (2.1). No session — the signature is the credential
 * (boardForTriggerToken's shape). The connection id is in the URL, so a bad id, a
 * non-GitHub connection, or a failed signature all answer the same way an
 * external caller should see: a flat 404/401 that leaks nothing about which repo
 * or whether the connection exists.
 *
 * The body is read as raw text and verified BEFORE parsing — the HMAC is over the
 * exact bytes GitHub sent, so a re-serialized body would never match.
 */
export async function handleGithubWebhook(request: Request, id: string) {
  const connectionId = Number(id);
  if (!Number.isInteger(connectionId)) return notFound();

  const resolved = await connectionForIngress(connectionId);
  if (!resolved || resolved.connection.provider !== "github") return notFound();

  const body = await request.text();
  const signature = request.headers.get("x-hub-signature-256");
  if (!verifyGithubSignature(resolved.secret, body, signature)) {
    return new Response(null, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return badRequest("Invalid JSON body");
  }

  const eventType = request.headers.get("x-github-event") ?? "";
  const events = normalizeGithubEvent(eventType, payload as Record<string, never>);
  let linked = 0;
  for (const event of events) {
    const result = await ingestEvent(resolved.connection, event);
    linked += result.linkedTaskIds.length;
  }
  return Response.json({ ok: true, linked });
}

/**
 * The GitLab webhook ingress (2.2) — the twin of handleGithubWebhook. GitLab
 * carries a plain secret in `X-Gitlab-Token` rather than an HMAC, so verification
 * is a constant-time token compare and the body may be read after it. A bad id, a
 * non-GitLab connection, or a failed token all answer the flat 404/401 an external
 * caller should see, leaking nothing about which repo or whether it exists.
 */
export async function handleGitlabWebhook(request: Request, id: string) {
  const connectionId = Number(id);
  if (!Number.isInteger(connectionId)) return notFound();

  const resolved = await connectionForIngress(connectionId);
  if (!resolved || resolved.connection.provider !== "gitlab") return notFound();

  const token = request.headers.get("x-gitlab-token");
  if (!verifyGitlabToken(resolved.secret, token)) {
    return new Response(null, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(await request.text());
  } catch {
    return badRequest("Invalid JSON body");
  }

  const events = normalizeGitlabEvent(payload as Record<string, never>);
  let linked = 0;
  for (const event of events) {
    const result = await ingestEvent(resolved.connection, event);
    linked += result.linkedTaskIds.length;
  }
  return Response.json({ ok: true, linked });
}

/**
 * The Bitbucket webhook ingress (2.3). Like GitHub, Bitbucket HMAC-signs the raw
 * body (`X-Hub-Signature: sha256=…`), so the body is read as raw text and verified
 * BEFORE parsing. The event type rides `X-Event-Key`. A bad id, a non-Bitbucket
 * connection, or a failed signature all answer the flat 404/401.
 */
export async function handleBitbucketWebhook(request: Request, id: string) {
  const connectionId = Number(id);
  if (!Number.isInteger(connectionId)) return notFound();

  const resolved = await connectionForIngress(connectionId);
  if (!resolved || resolved.connection.provider !== "bitbucket") return notFound();

  const body = await request.text();
  const signature = request.headers.get("x-hub-signature");
  if (!verifyBitbucketSignature(resolved.secret, body, signature)) {
    return new Response(null, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return badRequest("Invalid JSON body");
  }

  const eventKey = request.headers.get("x-event-key") ?? "";
  const events = normalizeBitbucketEvent(eventKey, payload as Record<string, never>);
  let linked = 0;
  for (const event of events) {
    const result = await ingestEvent(resolved.connection, event);
    linked += result.linkedTaskIds.length;
  }
  return Response.json({ ok: true, linked });
}
