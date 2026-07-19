import { randomBytes } from "node:crypto";

import { pool, query, queryOne } from "@/shared/db/client";
import {
  AuthzError,
  requireWorkspaceRole,
} from "@/features/workspaces/server/authz";
import type { Webhook } from "../types";

/**
 * Webhook management (025). Admin-gated throughout, agent management's
 * reasoning one door over: an endpoint that receives every board mutation is
 * infrastructure, not participation, and the handlers layer additionally
 * requires a human session — an external token must not aim the firehose.
 */

const WEBHOOK_COLUMNS = `id, workspace_id AS "workspaceId", url, events, active,
                         created_at AS "createdAt", last_status AS "lastStatus",
                         last_delivery_at AS "lastDeliveryAt"`;

export async function listWebhooks(
  userId: string,
  workspaceId: string
): Promise<Webhook[]> {
  await requireWorkspaceRole(userId, workspaceId, "admin");
  return query<Webhook>(
    `SELECT ${WEBHOOK_COLUMNS} FROM workspace_webhook
      WHERE workspace_id = $1 ORDER BY id`,
    [workspaceId]
  );
}

/**
 * Mints a webhook and its signing secret. The secret comes back exactly once,
 * beside the row — the agent-token convention (009), minus the hash: signing
 * needs the key itself on every delivery, so the row keeps it and the list
 * read simply never selects it.
 */
export async function createWebhook(
  userId: string,
  workspaceId: string,
  input: { url: string; events?: string[] }
): Promise<{ webhook: Webhook; secret: string }> {
  await requireWorkspaceRole(userId, workspaceId, "admin");

  let parsed: URL;
  try {
    parsed = new URL(input.url);
  } catch {
    throw new AuthzError("conflict", "That is not a valid URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new AuthzError("conflict", "A webhook URL must be http(s)");
  }

  const secret = `whs_${randomBytes(32).toString("hex")}`;
  const webhook = (await queryOne<Webhook>(
    `INSERT INTO workspace_webhook (workspace_id, url, secret, events)
     VALUES ($1, $2, $3, $4)
     RETURNING ${WEBHOOK_COLUMNS}`,
    [workspaceId, input.url, secret, input.events ?? []]
  ))!;
  return { webhook, secret };
}

/** Admin of the webhook's own workspace — resolved from the row, not trusted
 *  from the caller, the same one-join rule every requireXAccess follows. */
export async function deleteWebhook(
  userId: string,
  id: number
): Promise<boolean> {
  const row = await queryOne<{ workspaceId: string }>(
    `SELECT workspace_id AS "workspaceId" FROM workspace_webhook WHERE id = $1`,
    [id]
  );
  if (!row) return false;
  await requireWorkspaceRole(userId, row.workspaceId, "admin");
  const { rowCount } = await pool.query(
    `DELETE FROM workspace_webhook WHERE id = $1`,
    [id]
  );
  return (rowCount ?? 0) > 0;
}
