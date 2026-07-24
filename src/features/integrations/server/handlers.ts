import { getSessionFromRequest, unauthorized } from "@/features/auth/server/session";
import { authzErrorResponse, AuthzError } from "@/features/workspaces/server/authz";
import { consumeOAuthState, createOAuthState, listIntegrationConnections, removeIntegrationConnection, saveGoogleConnection, saveMicrosoftConnection, saveSlackConnection, saveTeamsWebhook } from "./repository";

const badRequest = (error: string) => Response.json({ error }, { status: 400 });

export async function listIntegrations(request: Request, workspaceId: string): Promise<Response> {
  const session = await getSessionFromRequest(request); if (!session) return unauthorized();
  try { return Response.json(await listIntegrationConnections(session.user.id, workspaceId)); }
  catch (error) { return authzErrorResponse(error); }
}

export async function createTeamsWebhook(request: Request, workspaceId: string): Promise<Response> {
  const session = await getSessionFromRequest(request); if (!session) return unauthorized();
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body.channelId !== "string" || typeof body.webhookUrl !== "string" || (body.name !== undefined && typeof body.name !== "string")) {
    return badRequest("channelId and webhookUrl are required");
  }
  try { return Response.json(await saveTeamsWebhook(session.user.id, workspaceId, { channelId: body.channelId, webhookUrl: body.webhookUrl, name: body.name as string | undefined }), { status: 201 }); }
  catch (error) { return authzErrorResponse(error); }
}

export async function deleteIntegration(request: Request, workspaceId: string, id: string): Promise<Response> {
  const session = await getSessionFromRequest(request); if (!session) return unauthorized();
  const connectionId = Number(id); if (!Number.isInteger(connectionId)) return badRequest("Invalid integration connection id");
  try { await removeIntegrationConnection(session.user.id, workspaceId, connectionId); return new Response(null, { status: 204 }); }
  catch (error) { return authzErrorResponse(error); }
}

function publicOrigin(): string {
  const origin = process.env.BETTER_AUTH_URL;
  if (!origin) throw new AuthzError("conflict", "BETTER_AUTH_URL must be configured before installing Slack");
  return new URL(origin).origin;
}

export async function startSlackInstall(request: Request, workspaceId: string): Promise<Response> {
  const session = await getSessionFromRequest(request); if (!session) return unauthorized();
  try {
    const clientId = process.env.SLACK_CLIENT_ID;
    if (!clientId) throw new AuthzError("conflict", "SLACK_CLIENT_ID is not configured");
    const state = await createOAuthState(session.user.id, workspaceId, "slack");
    const redirectUri = `${publicOrigin()}/api/integrations/slack/callback`;
    const url = new URL("https://slack.com/oauth/v2/authorize");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("scope", "chat:write,commands,links:read,links:write");
    url.searchParams.set("state", state);
    return Response.redirect(url, 302);
  } catch (error) { return authzErrorResponse(error); }
}

interface SlackOAuthResponse {
  ok: boolean; error?: string; access_token?: string; scope?: string;
  team?: { id?: string; name?: string }; bot_user_id?: string;
}

export async function finishSlackInstall(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const state = url.searchParams.get("state"); const code = url.searchParams.get("code");
  const oauthError = url.searchParams.get("error");
  if (oauthError) return Response.redirect(new URL(`/?integration=slack-error&reason=${encodeURIComponent(oauthError)}`, publicOrigin()), 302);
  if (!state || !code) return Response.json({ error: "Missing Slack OAuth callback fields" }, { status: 400 });
  try {
    const { workspaceId, userId } = await consumeOAuthState("slack", state);
    const clientId = process.env.SLACK_CLIENT_ID; const clientSecret = process.env.SLACK_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new AuthzError("conflict", "Slack OAuth credentials are not configured");
    const response = await fetch("https://slack.com/api/oauth.v2.access", {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: `${publicOrigin()}/api/integrations/slack/callback` }),
      signal: AbortSignal.timeout(10_000),
    });
    const payload = await response.json().catch(() => null) as SlackOAuthResponse | null;
    if (!response.ok || !payload?.ok || !payload.access_token || !payload.team?.id) throw new AuthzError("conflict", `Slack authorization failed: ${payload?.error ?? response.status}`);
    await saveSlackConnection(userId, workspaceId, { teamId: payload.team.id, teamName: payload.team.name, botUserId: payload.bot_user_id, accessToken: payload.access_token, scopes: payload.scope?.split(",").filter(Boolean) });
    return Response.redirect(new URL("/?integration=slack-connected", publicOrigin()), 302);
  } catch (error) { return authzErrorResponse(error); }
}

const GOOGLE_SCOPES = ["https://www.googleapis.com/auth/drive.metadata.readonly", "https://www.googleapis.com/auth/calendar"];

export async function startGoogleInstall(request: Request, workspaceId: string): Promise<Response> {
  const session = await getSessionFromRequest(request); if (!session) return unauthorized();
  try {
    const clientId = process.env.GOOGLE_CLIENT_ID; if (!clientId) throw new AuthzError("conflict", "GOOGLE_CLIENT_ID is not configured");
    const state = await createOAuthState(session.user.id, workspaceId, "google");
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", clientId); url.searchParams.set("redirect_uri", `${publicOrigin()}/api/integrations/google/callback`);
    url.searchParams.set("response_type", "code"); url.searchParams.set("scope", GOOGLE_SCOPES.join(" ")); url.searchParams.set("state", state);
    url.searchParams.set("access_type", "offline"); url.searchParams.set("include_granted_scopes", "true"); url.searchParams.set("prompt", "consent");
    return Response.redirect(url, 302);
  } catch (error) { return authzErrorResponse(error); }
}

export async function finishGoogleInstall(request: Request): Promise<Response> {
  const url = new URL(request.url); const state = url.searchParams.get("state"); const code = url.searchParams.get("code");
  if (url.searchParams.get("error")) return Response.redirect(new URL("/?integration=google-error", publicOrigin()), 302);
  if (!state || !code) return badRequest("Missing Google OAuth callback fields");
  try {
    const { workspaceId, userId } = await consumeOAuthState("google", state);
    const clientId = process.env.GOOGLE_CLIENT_ID; const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new AuthzError("conflict", "Google OAuth credentials are not configured");
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: `${publicOrigin()}/api/integrations/google/callback`, grant_type: "authorization_code" }), signal: AbortSignal.timeout(10_000) });
    const token = await tokenResponse.json().catch(() => null) as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string } | null;
    if (!tokenResponse.ok || !token?.access_token) throw new AuthzError("conflict", "Google authorization failed");
    const profileResponse = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", { headers: { authorization: `Bearer ${token.access_token}` }, signal: AbortSignal.timeout(10_000) });
    const profile = await profileResponse.json().catch(() => null) as { email?: string } | null;
    await saveGoogleConnection(userId, workspaceId, { accessToken: token.access_token, refreshToken: token.refresh_token, scopes: token.scope?.split(" ").filter(Boolean) ?? GOOGLE_SCOPES, email: profile?.email, expiresIn: token.expires_in });
    return Response.redirect(new URL("/?integration=google-connected", publicOrigin()), 302);
  } catch (error) { return authzErrorResponse(error); }
}

const MICROSOFT_SCOPES = ["offline_access", "User.Read", "Files.Read", "Calendars.ReadWrite"];
const microsoftTenant = () => process.env.MICROSOFT_TENANT_ID?.trim() || "organizations";
export async function startMicrosoftInstall(request: Request, workspaceId: string): Promise<Response> {
  const session = await getSessionFromRequest(request); if (!session) return unauthorized();
  try {
    const clientId = process.env.MICROSOFT_CLIENT_ID; if (!clientId) throw new AuthzError("conflict", "MICROSOFT_CLIENT_ID is not configured");
    const state = await createOAuthState(session.user.id, workspaceId, "microsoft");
    const url = new URL(`https://login.microsoftonline.com/${encodeURIComponent(microsoftTenant())}/oauth2/v2.0/authorize`);
    url.searchParams.set("client_id", clientId); url.searchParams.set("response_type", "code"); url.searchParams.set("redirect_uri", `${publicOrigin()}/api/integrations/microsoft/callback`); url.searchParams.set("response_mode", "query"); url.searchParams.set("scope", MICROSOFT_SCOPES.join(" ")); url.searchParams.set("state", state);
    return Response.redirect(url, 302);
  } catch (error) { return authzErrorResponse(error); }
}
export async function finishMicrosoftInstall(request: Request): Promise<Response> {
  const url = new URL(request.url); const state = url.searchParams.get("state"); const code = url.searchParams.get("code");
  if (url.searchParams.get("error")) return Response.redirect(new URL("/?integration=microsoft-error", publicOrigin()), 302);
  if (!state || !code) return badRequest("Missing Microsoft OAuth callback fields");
  try {
    const { workspaceId, userId } = await consumeOAuthState("microsoft", state); const clientId = process.env.MICROSOFT_CLIENT_ID; const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new AuthzError("conflict", "Microsoft OAuth credentials are not configured");
    const tokenResponse = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(microsoftTenant())}/oauth2/v2.0/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: `${publicOrigin()}/api/integrations/microsoft/callback`, grant_type: "authorization_code", scope: MICROSOFT_SCOPES.join(" ") }), signal: AbortSignal.timeout(10_000) });
    const token = await tokenResponse.json().catch(() => null) as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string } | null;
    if (!tokenResponse.ok || !token?.access_token) throw new AuthzError("conflict", "Microsoft authorization failed");
    const profileResponse = await fetch("https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName", { headers: { authorization: `Bearer ${token.access_token}` }, signal: AbortSignal.timeout(10_000) });
    const profile = await profileResponse.json().catch(() => null) as { mail?: string; userPrincipalName?: string } | null;
    await saveMicrosoftConnection(userId, workspaceId, { accessToken: token.access_token, refreshToken: token.refresh_token, scopes: token.scope?.split(" ").filter(Boolean) ?? MICROSOFT_SCOPES, email: profile?.mail ?? profile?.userPrincipalName, expiresIn: token.expires_in });
    return Response.redirect(new URL("/?integration=microsoft-connected", publicOrigin()), 302);
  } catch (error) { return authzErrorResponse(error); }
}
