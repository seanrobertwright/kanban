import { createHash, randomBytes, randomUUID } from "node:crypto";

import { query, queryOne } from "@/shared/db/client";

/**
 * Self-service management of personal API keys — the human counterpart to
 * agents/server/admin.ts, with one deliberate inversion: there is no role
 * check anywhere here, because a key is not a workspace resource. Every
 * operation is scoped `WHERE user_id = $me`, so a user manages exactly their
 * own keys and can never see, mint, or revoke anyone else's. What a key can
 * *do* is decided per request by the same role lookups a cookie session gets.
 *
 * The handlers that call this must authenticate with a real session (cookie),
 * never with a key: a leaked key that could mint further keys would turn one
 * compromised credential into an unbounded supply, and revoking the original
 * would no longer end the incident.
 */

export interface UserApiKeyDetail {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
}

const SELECT_KEY = `SELECT id, name,
                           created_at   AS "createdAt",
                           last_used_at AS "lastUsedAt"
                      FROM user_api_key`;

export async function listUserApiKeys(userId: string): Promise<UserApiKeyDetail[]> {
  return query<UserApiKeyDetail>(
    `${SELECT_KEY} WHERE user_id = $1 ORDER BY created_at DESC, id`,
    [userId]
  );
}

/**
 * Mints a key. The token exists exactly once, in this return value; only its
 * sha256 lands in the row (the agent pattern, 009). `kbu_` — kanban user —
 * keeps a leaked token greppable and visually distinct from an agent's `kbn_`.
 */
export async function createUserApiKey(
  userId: string,
  name: string
): Promise<{ key: UserApiKeyDetail; token: string }> {
  const token = `kbu_${randomBytes(32).toString("hex")}`;
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const key = await queryOne<UserApiKeyDetail>(
    `INSERT INTO user_api_key (id, user_id, name, token_hash)
     VALUES ($1, $2, $3, $4)
     RETURNING id, name, created_at AS "createdAt", last_used_at AS "lastUsedAt"`,
    [randomUUID(), userId, name, tokenHash]
  );
  return { key: key!, token };
}

/** Revokes a key. Deleting someone else's id resolves to no row → false. */
export async function deleteUserApiKey(
  userId: string,
  keyId: string
): Promise<boolean> {
  const rows = await query(
    `DELETE FROM user_api_key WHERE id = $1 AND user_id = $2 RETURNING id`,
    [keyId, userId]
  );
  return rows.length > 0;
}
