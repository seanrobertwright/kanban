import { createHash } from "node:crypto";

import { queryOne } from "@/shared/db/client";
import { getSessionFromRequest } from "./session";
import type { Principal } from "./principal";

/**
 * The header an external agent presents its token in. `x-agent-key` rather than
 * `Authorization: Bearer` deliberately: an agent key is a distinct credential
 * class from a user session, and a separate header keeps the two resolution paths
 * from ever being confused for one another — a request carries a cookie or a key,
 * and getPrincipalFromRequest tries them in that order.
 */
export const AGENT_KEY_HEADER = "x-agent-key";

/**
 * Only the hash is ever stored (009), so this is the one function that turns a
 * presented token into the value the `agent` row holds. sha256 is right here
 * where bcrypt would be wrong: the token is a 256-bit random string, not a
 * low-entropy human password, so there is nothing to brute-force and no reason to
 * pay a slow KDF on every agent request. The secret is the token's entropy.
 */
export function hashAgentToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Resolves an agent bearer token to its principal, or null. The lookup is by
 * token_hash (UNIQUE, 009), so it returns at most one agent, and it carries the
 * agent's workspace_id out — which the RBAC branch needs to prove a resource
 * belongs to the agent's one workspace without a second query.
 */
export async function getAgentByToken(
  token: string
): Promise<Principal | null> {
  const row = await queryOne<{ id: string; workspaceId: string }>(
    `SELECT id, workspace_id AS "workspaceId" FROM agent WHERE token_hash = $1`,
    [hashAgentToken(token)]
  );
  return row
    ? { kind: "agent", agentId: row.id, workspaceId: row.workspaceId }
    : null;
}

/**
 * The single auth entry point for a request, resolving it to a principal or null.
 *
 * A cookie wins over a key: an ordinary browser request never carries an agent
 * header, so the common path is one session lookup and no more. Only when there
 * is no session does the agent header get considered — which is what keeps this a
 * strict superset of the old getSessionFromRequest behaviour, with the human path
 * byte-for-byte unchanged.
 */
export async function getPrincipalFromRequest(
  request: Request
): Promise<Principal | null> {
  const session = await getSessionFromRequest(request);
  if (session) return { kind: "human", userId: session.user.id };

  const key = request.headers.get(AGENT_KEY_HEADER);
  if (key) return getAgentByToken(key);

  return null;
}
