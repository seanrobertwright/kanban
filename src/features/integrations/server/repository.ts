import { decryptSecret, encryptSecret } from "@/shared/crypto/secret-box";
import { randomUUID } from "node:crypto";
import { query, queryOne } from "@/shared/db/client";
import { AuthzError, requireWorkspaceRole } from "@/features/workspaces/server/authz";
import type { IntegrationConnection, IntegrationProvider, SlackConnection } from "../types";

const COLUMNS = `id, workspace_id AS "workspaceId", provider,
  external_id AS "externalId", scopes, metadata, created_by AS "createdBy",
  created_at AS "createdAt", updated_at AS "updatedAt"`;

export async function listIntegrationConnections(userId: string, workspaceId: string): Promise<IntegrationConnection[]> {
  await requireWorkspaceRole(userId, workspaceId, "admin");
  return query<IntegrationConnection>(`SELECT ${COLUMNS} FROM integration_connection WHERE workspace_id=$1 ORDER BY provider, id`, [workspaceId]);
}

/** Called only after the OAuth callback has authenticated the provider response.
 * The raw token never appears in a returned API shape or a log row. */
export async function saveSlackConnection(userId: string, workspaceId: string, input: {
  teamId: string; teamName?: string; botUserId?: string; accessToken: string; scopes?: string[];
}): Promise<SlackConnection> {
  await requireWorkspaceRole(userId, workspaceId, "admin");
  if (!/^T[A-Z0-9]+$/.test(input.teamId) || !/^xoxb-[A-Za-z0-9-]+$/.test(input.accessToken)) {
    throw new AuthzError("conflict", "Invalid Slack installation response");
  }
  return (await queryOne<SlackConnection>(
    `INSERT INTO integration_connection(workspace_id, provider, external_id, access_token, scopes, metadata, created_by)
     VALUES($1,'slack',$2,$3,$4,$5,$6)
     ON CONFLICT(workspace_id, provider, external_id) DO UPDATE
       SET access_token=EXCLUDED.access_token, scopes=EXCLUDED.scopes,
           metadata=EXCLUDED.metadata, created_by=EXCLUDED.created_by, updated_at=now()
     RETURNING ${COLUMNS}`,
    [workspaceId, input.teamId, encryptSecret(input.accessToken), input.scopes ?? [], JSON.stringify({ teamName: input.teamName, botUserId: input.botUserId }), userId]
  ))!;
}

export async function removeIntegrationConnection(userId: string, workspaceId: string, id: number): Promise<void> {
  await requireWorkspaceRole(userId, workspaceId, "admin");
  const row = await queryOne<{ id: number }>(`DELETE FROM integration_connection WHERE id=$1 AND workspace_id=$2 RETURNING id`, [id, workspaceId]);
  if (!row) throw new AuthzError("not_found", "Integration connection not found");
}

export async function slackToken(workspaceId: string): Promise<string | null> {
  const row = await queryOne<{ accessToken: string }>(
    `SELECT access_token AS "accessToken" FROM integration_connection
      WHERE workspace_id=$1 AND provider='slack' ORDER BY updated_at DESC LIMIT 1`,
    [workspaceId]
  );
  return row ? decryptSecret(row.accessToken) : null;
}

export async function createOAuthState(userId: string, workspaceId: string, provider: Exclude<IntegrationProvider, "email">): Promise<string> {
  await requireWorkspaceRole(userId, workspaceId, "admin");
  const id = randomUUID();
  await query(
    `INSERT INTO integration_oauth_state(id, provider, workspace_id, user_id, expires_at)
     VALUES($1,$2,$3,$4,now() + interval '10 minutes')`,
    [id, provider, workspaceId, userId]
  );
  return id;
}

/** Delete-returning makes an OAuth state one-time use even under concurrent
 * callbacks. The state is also tied to its initiating administrator. */
export async function consumeOAuthState(provider: Exclude<IntegrationProvider, "email">, state: string): Promise<{ workspaceId: string; userId: string }> {
  const row = await queryOne<{ workspaceId: string; userId: string }>(
    `DELETE FROM integration_oauth_state
      WHERE id=$1 AND provider=$2 AND expires_at > now()
      RETURNING workspace_id AS "workspaceId", user_id AS "userId"`,
    [state, provider]
  );
  if (!row) throw new AuthzError("not_found", "OAuth installation session has expired");
  return row;
}

/** Low-level delivery adapter shared by automation and future mentions/SLA. */
export async function postSlackMessage(workspaceId: string, channelId: string, text: string): Promise<void> {
  if (!/^[CGD][A-Z0-9]+$/.test(channelId)) throw new AuthzError("conflict", "Invalid Slack channel id");
  const token = await slackToken(workspaceId);
  if (!token) throw new AuthzError("not_found", "No Slack installation is connected to this workspace");
  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ channel: channelId, text }), signal: AbortSignal.timeout(10_000),
  });
  const payload = await response.json().catch(() => null) as { ok?: boolean; error?: string } | null;
  if (!response.ok || !payload?.ok) throw new Error(`Slack delivery failed: ${payload?.error ?? response.status}`);
}

export async function postSlackUnfurl(workspaceId: string, channelId: string, unfurls: Record<string, { text: string }>): Promise<void> {
  const token = await slackToken(workspaceId);
  if (!token) throw new AuthzError("not_found", "No Slack installation is connected to this workspace");
  const response = await fetch("https://slack.com/api/chat.unfurl", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json; charset=utf-8" }, body: JSON.stringify({ channel: channelId, unfurls }), signal: AbortSignal.timeout(10_000) });
  const payload = await response.json().catch(() => null) as { ok?: boolean; error?: string } | null;
  if (!response.ok || !payload?.ok) throw new Error(`Slack unfurl failed: ${payload?.error ?? response.status}`);
}

/** Teams incoming webhooks are per-channel bearer URLs. Store the URL only as
 * ciphertext; callers use this stable connection id rather than copying it into
 * automation JSON. A Bot Framework adapter can share the same provider row. */
export async function saveTeamsWebhook(userId: string, workspaceId: string, input: { channelId: string; webhookUrl: string; name?: string }): Promise<IntegrationConnection> {
  await requireWorkspaceRole(userId, workspaceId, "admin");
  let url: URL;
  try { url = new URL(input.webhookUrl); } catch { throw new AuthzError("conflict", "Invalid Teams webhook URL"); }
  const host = url.hostname.toLowerCase();
  const isMicrosoftWebhook = host === "webhook.office.com" || host.endsWith(".webhook.office.com") ||
    host === "office.com" || host.endsWith(".office.com") ||
    host === "teams.microsoft.com" || host.endsWith(".teams.microsoft.com");
  if (url.protocol !== "https:" || !isMicrosoftWebhook) throw new AuthzError("conflict", "Teams webhook URL must use an official HTTPS endpoint");
  if (!input.channelId.trim()) throw new AuthzError("conflict", "A Teams channel id is required");
  return (await queryOne<IntegrationConnection>(
    `INSERT INTO integration_connection(workspace_id, provider, external_id, access_token, metadata, created_by)
     VALUES($1,'teams',$2,$3,$4,$5)
     ON CONFLICT(workspace_id, provider, external_id) DO UPDATE
       SET access_token=EXCLUDED.access_token, metadata=EXCLUDED.metadata, created_by=EXCLUDED.created_by, updated_at=now()
     RETURNING ${COLUMNS}`,
    [workspaceId, input.channelId.trim(), encryptSecret(url.toString()), JSON.stringify({ name: input.name }), userId]
  ))!;
}

export async function postTeamsMessage(workspaceId: string, connectionId: number, text: string): Promise<void> {
  const row = await queryOne<{ accessToken: string }>(`SELECT access_token AS "accessToken" FROM integration_connection WHERE id=$1 AND workspace_id=$2 AND provider='teams'`, [connectionId, workspaceId]);
  if (!row) throw new AuthzError("not_found", "Teams channel connection not found");
  const response = await fetch(decryptSecret(row.accessToken), {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "message", attachments: [{ contentType: "application/vnd.microsoft.card.adaptive", content: { "$schema": "http://adaptivecards.io/schemas/adaptive-card.json", type: "AdaptiveCard", version: "1.4", body: [{ type: "TextBlock", wrap: true, text }] } }] }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Teams delivery failed: ${response.status}`);
}

export async function saveGoogleConnection(userId: string, workspaceId: string, input: { accessToken: string; refreshToken?: string; scopes: string[]; email?: string; expiresIn?: number }): Promise<IntegrationConnection> {
  await requireWorkspaceRole(userId, workspaceId, "admin");
  if (!input.accessToken || input.accessToken.length < 20) throw new AuthzError("conflict", "Invalid Google OAuth response");
  const expiresAt = new Date(Date.now() + Math.max(60, input.expiresIn ?? 3600) * 1000).toISOString();
  return (await queryOne<IntegrationConnection>(
    `INSERT INTO integration_connection(workspace_id, provider, external_id, access_token, refresh_token, scopes, metadata, created_by)
     VALUES($1,'google','primary',$2,$3,$4,$5,$6)
     ON CONFLICT(workspace_id, provider, external_id) DO UPDATE SET
       access_token=EXCLUDED.access_token, refresh_token=COALESCE(EXCLUDED.refresh_token, integration_connection.refresh_token),
       scopes=EXCLUDED.scopes, metadata=EXCLUDED.metadata, created_by=EXCLUDED.created_by, updated_at=now()
     RETURNING ${COLUMNS}`,
    [workspaceId, encryptSecret(input.accessToken), input.refreshToken ? encryptSecret(input.refreshToken) : null, input.scopes, JSON.stringify({ email: input.email, expiresAt }), userId]
  ))!;
}

export async function googleAccessToken(workspaceId: string): Promise<string> {
  const row = await queryOne<{ id: number; accessToken: string; refreshToken: string | null; metadata: { expiresAt?: string } }>(
    `SELECT id, access_token AS "accessToken", refresh_token AS "refreshToken", metadata FROM integration_connection
      WHERE workspace_id=$1 AND provider='google' AND external_id='primary'`, [workspaceId]
  );
  if (!row) throw new AuthzError("not_found", "No Google Workspace connection is configured");
  if (row.metadata?.expiresAt && Date.parse(row.metadata.expiresAt) > Date.now() + 60_000) return decryptSecret(row.accessToken);
  if (!row.refreshToken) throw new AuthzError("conflict", "Reconnect Google Workspace to refresh its access token");
  const clientId = process.env.GOOGLE_CLIENT_ID; const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new AuthzError("conflict", "Google OAuth credentials are not configured");
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: decryptSecret(row.refreshToken), grant_type: "refresh_token" }), signal: AbortSignal.timeout(10_000) });
  const payload = await response.json().catch(() => null) as { access_token?: string; expires_in?: number } | null;
  if (!response.ok || !payload?.access_token) throw new AuthzError("conflict", "Google refresh token was rejected; reconnect the integration");
  const metadata = { ...(row.metadata ?? {}), expiresAt: new Date(Date.now() + Math.max(60, payload.expires_in ?? 3600) * 1000).toISOString() };
  await query(`UPDATE integration_connection SET access_token=$2, metadata=$3, updated_at=now() WHERE id=$1`, [row.id, encryptSecret(payload.access_token), JSON.stringify(metadata)]);
  return payload.access_token;
}

function microsoftTenant(): string { return process.env.MICROSOFT_TENANT_ID?.trim() || "organizations"; }
export async function saveMicrosoftConnection(userId: string, workspaceId: string, input: { accessToken: string; refreshToken?: string; scopes: string[]; email?: string; expiresIn?: number }): Promise<IntegrationConnection> {
  await requireWorkspaceRole(userId, workspaceId, "admin");
  if (!input.accessToken || input.accessToken.length < 20) throw new AuthzError("conflict", "Invalid Microsoft OAuth response");
  const expiresAt = new Date(Date.now() + Math.max(60, input.expiresIn ?? 3600) * 1000).toISOString();
  return (await queryOne<IntegrationConnection>(
    `INSERT INTO integration_connection(workspace_id,provider,external_id,access_token,refresh_token,scopes,metadata,created_by) VALUES($1,'microsoft','primary',$2,$3,$4,$5,$6)
     ON CONFLICT(workspace_id,provider,external_id) DO UPDATE SET access_token=EXCLUDED.access_token,refresh_token=COALESCE(EXCLUDED.refresh_token,integration_connection.refresh_token),scopes=EXCLUDED.scopes,metadata=EXCLUDED.metadata,created_by=EXCLUDED.created_by,updated_at=now() RETURNING ${COLUMNS}`,
    [workspaceId, encryptSecret(input.accessToken), input.refreshToken ? encryptSecret(input.refreshToken) : null, input.scopes, JSON.stringify({ email: input.email, expiresAt }), userId]
  ))!;
}
export async function microsoftAccessToken(workspaceId: string): Promise<string> {
  const row = await queryOne<{ id: number; accessToken: string; refreshToken: string | null; metadata: { expiresAt?: string } }>(`SELECT id,access_token AS "accessToken",refresh_token AS "refreshToken",metadata FROM integration_connection WHERE workspace_id=$1 AND provider='microsoft' AND external_id='primary'`, [workspaceId]);
  if (!row) throw new AuthzError("not_found", "No Microsoft 365 connection is configured");
  if (row.metadata?.expiresAt && Date.parse(row.metadata.expiresAt) > Date.now() + 60_000) return decryptSecret(row.accessToken);
  if (!row.refreshToken) throw new AuthzError("conflict", "Reconnect Microsoft 365 to refresh its access token");
  const clientId = process.env.MICROSOFT_CLIENT_ID; const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new AuthzError("conflict", "Microsoft OAuth credentials are not configured");
  const response = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(microsoftTenant())}/oauth2/v2.0/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: decryptSecret(row.refreshToken), grant_type: "refresh_token", scope: "offline_access User.Read Files.Read Calendars.ReadWrite" }), signal: AbortSignal.timeout(10_000) });
  const payload = await response.json().catch(() => null) as { access_token?: string; refresh_token?: string; expires_in?: number } | null;
  if (!response.ok || !payload?.access_token) throw new AuthzError("conflict", "Microsoft refresh token was rejected; reconnect the integration");
  const metadata = { ...(row.metadata ?? {}), expiresAt: new Date(Date.now() + Math.max(60, payload.expires_in ?? 3600) * 1000).toISOString() };
  await query(`UPDATE integration_connection SET access_token=$2,refresh_token=$3,metadata=$4,updated_at=now() WHERE id=$1`, [row.id, encryptSecret(payload.access_token), payload.refresh_token ? encryptSecret(payload.refresh_token) : row.refreshToken, JSON.stringify(metadata)]);
  return payload.access_token;
}
