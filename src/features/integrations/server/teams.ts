import { queryOne } from "@/shared/db/client";
import { createTask } from "@/features/tasks/server/repository";

type JwtHeader = { alg?: string; kid?: string };
type JwtClaims = { aud?: string | string[]; exp?: number; nbf?: number; iss?: string; serviceurl?: string };
type BotOpenIdMetadata = { issuer: string; jwks_uri: string };
type JsonWebKeySet = { keys: Array<JsonWebKey & { kid?: string }> };

const OPENID_CONFIGURATION_URL = "https://login.botframework.com/v1/.well-known/openidconfiguration";
let cachedKeys: { expiresAt: number; metadata: BotOpenIdMetadata; keys: JsonWebKeySet } | null = null;

function decodeSegment<T>(segment: string): T | null {
  try {
    return JSON.parse(Buffer.from(segment, "base64url").toString("utf8")) as T;
  } catch { return null; }
}

async function botSigningKeys(): Promise<{ metadata: BotOpenIdMetadata; keys: JsonWebKeySet }> {
  if (cachedKeys && cachedKeys.expiresAt > Date.now()) return cachedKeys;
  const metadataResponse = await fetch(OPENID_CONFIGURATION_URL, { signal: AbortSignal.timeout(10_000) });
  const metadata = await metadataResponse.json().catch(() => null) as BotOpenIdMetadata | null;
  if (!metadataResponse.ok || !metadata?.issuer || !metadata.jwks_uri || new URL(metadata.jwks_uri).protocol !== "https:") {
    throw new Error("Could not retrieve the Bot Framework signing metadata");
  }
  const keysResponse = await fetch(metadata.jwks_uri, { signal: AbortSignal.timeout(10_000) });
  const keys = await keysResponse.json().catch(() => null) as JsonWebKeySet | null;
  if (!keysResponse.ok || !keys?.keys?.length) throw new Error("Could not retrieve Bot Framework signing keys");
  cachedKeys = { expiresAt: Date.now() + 60 * 60 * 1000, metadata, keys };
  return cachedKeys;
}

/** Verifies a Bot Framework channel token with the provider's published JWK.
 * We deliberately do not offer a development bypass: an unauthenticated Teams
 * activity could otherwise create a task as the workspace integration owner. */
export async function verifyTeamsBotToken(authorization: string | null, serviceUrl?: string): Promise<boolean> {
  const appId = process.env.TEAMS_BOT_APP_ID;
  if (!appId || !authorization?.startsWith("Bearer ")) return false;
  const parts = authorization.slice(7).split(".");
  if (parts.length !== 3) return false;
  const header = decodeSegment<JwtHeader>(parts[0]);
  const claims = decodeSegment<JwtClaims>(parts[1]);
  if (!header || header.alg !== "RS256" || !header.kid || !claims || !Number.isFinite(claims.exp)) return false;
  const now = Math.floor(Date.now() / 1000);
  if ((claims.exp as number) <= now - 60 || (typeof claims.nbf === "number" && claims.nbf > now + 60)) return false;
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audience.includes(appId)) return false;
  if (serviceUrl && claims.serviceurl && claims.serviceurl !== serviceUrl) return false;
  try {
    const { metadata, keys } = await botSigningKeys();
    if (claims.iss !== metadata.issuer && claims.iss !== "https://api.botframework.com") return false;
    const jwk = keys.keys.find((key) => key.kid === header.kid && key.kty === "RSA");
    if (!jwk) return false;
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    return crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, Buffer.from(parts[2], "base64url"), Buffer.from(`${parts[0]}.${parts[1]}`));
  } catch { return false; }
}

interface TeamsActivity {
  type?: string; text?: string; serviceUrl?: string;
  conversation?: { id?: string };
  channelData?: { channel?: { id?: string }; team?: { id?: string } };
}

export async function handleTeamsActivity(request: Request): Promise<Response> {
  const activity = await request.json().catch(() => null) as TeamsActivity | null;
  if (!activity || !(await verifyTeamsBotToken(request.headers.get("authorization"), activity.serviceUrl))) {
    return Response.json({ error: "Invalid Bot Framework token" }, { status: 401 });
  }
  if (activity.type !== "message") return new Response(null, { status: 202 });
  const title = activity.text?.replace(/<at>.*?<\/at>/gi, "").trim().match(/^create\s+(.+)$/i)?.[1];
  if (!title) return Response.json({ type: "message", text: "Use `create <task title>` to create a task." });
  const identifiers = [activity.channelData?.channel?.id, activity.conversation?.id, activity.channelData?.team?.id]
    .filter((id): id is string => Boolean(id));
  const connection = await queryOne<{ workspaceId: string; createdBy: string }>(
    `SELECT workspace_id AS "workspaceId", created_by AS "createdBy" FROM integration_connection
      WHERE provider='teams' AND external_id = ANY($1::text[]) ORDER BY updated_at DESC LIMIT 1`, [identifiers]
  );
  if (!connection) return Response.json({ type: "message", text: "This Teams channel is not connected to a workspace." });
  const column = await queryOne<{ id: number }>(
    `SELECT c.id FROM board b JOIN board_column c ON c.board_id=b.id
      WHERE b.workspace_id=$1 ORDER BY b.position, c.position LIMIT 1`, [connection.workspaceId]
  );
  if (!column) return Response.json({ type: "message", text: "No board column is available for this workspace." });
  const task = await createTask(connection.createdBy, { columnId: column.id, title: title.slice(0, 500) });
  return Response.json({ type: "message", text: `Created task #${task.id}: ${task.title}` });
}
