import { query, queryOne } from "@/shared/db/client";
import { hashAgentToken } from "./agent-auth";
import type { Principal } from "./principal";

/**
 * The header a personal API key travels in. A third header for a third
 * credential class, for the same reason agent-auth.ts gives for the second:
 * a request carries a cookie, an agent key, OR a user key, and separate
 * headers keep the resolution paths from ever being confused for one another.
 * `Authorization: Bearer` is deliberately not reused — better-auth's bearer
 * plugin interprets that header as a session token, and a long-lived key
 * masquerading as a short-lived session is exactly the confusion to avoid.
 */
export const USER_KEY_HEADER = "x-user-key";

/**
 * Resolves a personal API key to its owning HUMAN principal, or null.
 *
 * The hash is the agent one on purpose (sha256 of a 256-bit random token —
 * see hashAgentToken for why no KDF). The principal carries no workspace:
 * a person's workspace roles are looked up per request exactly as they are
 * for a cookie session, so a key grants what its owner currently has and
 * nothing the owner has lost since minting it.
 */
export async function getUserByApiKey(token: string): Promise<Principal | null> {
  const hash = hashAgentToken(token);
  const row = await queryOne<{ id: string; userId: string }>(
    `SELECT id, user_id AS "userId" FROM user_api_key WHERE token_hash = $1`,
    [hash]
  );
  if (!row) return null;

  // "Unused since May" must be answerable, but not at a write per request:
  // touch last_used_at only when it is stale by an hour or never set. Fire
  // and forget — a failed touch must not fail the request it rode in on.
  void query(
    `UPDATE user_api_key
        SET last_used_at = now()
      WHERE id = $1
        AND (last_used_at IS NULL OR last_used_at < now() - interval '1 hour')`,
    [row.id]
  ).catch(() => {});

  return { kind: "human", userId: row.userId };
}
