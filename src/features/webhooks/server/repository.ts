import { randomBytes } from "node:crypto";

import { pool, query, queryOne } from "@/shared/db/client";
import {
  AuthzError,
  requireWorkspaceRole,
} from "@/features/workspaces/server/authz";
import type { Webhook } from "../types";
import { encryptSecret } from "@/shared/crypto/secret-box";

/**
 * Webhook management (025). Admin-gated throughout, agent management's
 * reasoning one door over: an endpoint that receives every board mutation is
 * infrastructure, not participation, and the handlers layer additionally
 * requires a human session — an external token must not aim the firehose.
 */

const WEBHOOK_COLUMNS = `id, workspace_id AS "workspaceId", url, events, active,
                         created_at AS "createdAt", last_status AS "lastStatus",
                         last_delivery_at AS "lastDeliveryAt"`;

/**
 * The SSRF gate. Delivery is a server-side POST to a URL a *workspace* admin
 * typed, and a workspace admin is not the infrastructure owner — without this
 * they could aim the server at loopback services, the private network, or a
 * cloud metadata endpoint (169.254.169.254) and read the response's absence
 * into the last_status telemetry.
 *
 * Checked at creation against the literal host. The known residue: a public
 * DNS name that *resolves* privately (or rebinds later) slips through — closing
 * that means resolving-and-pinning at delivery time, which is a dependency and
 * a redesign; this gate closes the whole literal-address class today, which is
 * where the practical attacks live. WEBHOOK_ALLOW_PRIVATE_NETWORK=1 is the
 * self-hosted escape hatch (a dev box delivering to its own n8n), and the
 * tests set it: the flag is deployment configuration, not a hidden default.
 */
function assertPublicTarget(url: URL): void {
  if (process.env.WEBHOOK_ALLOW_PRIVATE_NETWORK === "1") return;

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const refuse = () => {
    throw new AuthzError(
      "conflict",
      "A webhook cannot target a private or internal address"
    );
  };

  if (host === "localhost" || host.endsWith(".localhost")) refuse();
  if (host === "::1" || host === "0.0.0.0" || host === "::") refuse();

  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (
      a === 127 || // loopback
      a === 10 || // RFC1918
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) || // link-local, incl. cloud metadata
      a === 0
    )
      refuse();
  }
  // IPv6 private/link-local literals (fc00::/7, fe80::/10) and v4-mapped forms.
  if (/^(fc|fd|fe8|fe9|fea|feb)/.test(host)) refuse();
  if (host.startsWith("::ffff:")) refuse();
}

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
  assertPublicTarget(parsed);

  const secret = `whs_${randomBytes(32).toString("hex")}`;
  const webhook = (await queryOne<Webhook>(
    `INSERT INTO workspace_webhook (workspace_id, url, secret, events)
     VALUES ($1, $2, $3, $4)
     RETURNING ${WEBHOOK_COLUMNS}`,
    [workspaceId, input.url, encryptSecret(secret), input.events ?? []]
  ))!;
  return { webhook, secret };
}

/**
 * Edit a webhook in place: its URL, its event filter, whether it is active, and
 * — separately — a rotation of its signing secret.
 *
 * Before this the only edit was delete-and-recreate, which is not the same
 * operation: it drops the delivery history (082's rows cascade with the hook)
 * and forces a secret rotation on a subscriber that only wanted its filter
 * narrowed. Pausing was likewise unreachable, so an admin with a noisy endpoint
 * had to delete it and rebuild it later from memory.
 *
 * A rotation returns the new secret exactly once, createWebhook's convention.
 * It is a separate flag rather than something a caller can set, because a
 * secret a caller chooses is a secret that has already been somewhere else.
 */
export async function updateWebhook(
  userId: string,
  id: number,
  input: {
    url?: string;
    events?: string[];
    active?: boolean;
    rotateSecret?: boolean;
  }
): Promise<{ webhook: Webhook; secret?: string } | undefined> {
  const row = await queryOne<{ workspaceId: string }>(
    `SELECT workspace_id AS "workspaceId" FROM workspace_webhook WHERE id = $1`,
    [id]
  );
  if (!row) return undefined;
  await requireWorkspaceRole(userId, row.workspaceId, "admin");

  const sets: string[] = [];
  const params: unknown[] = [id];
  const bind = (value: unknown) => `$${params.push(value)}`;

  if (input.url !== undefined) {
    // The same three gates createWebhook applies, and applied here for the
    // reason they exist: an edit that skipped them would be the way to point a
    // webhook at the metadata service after passing the check at creation.
    let parsed: URL;
    try {
      parsed = new URL(input.url);
    } catch {
      throw new AuthzError("conflict", "That is not a valid URL");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new AuthzError("conflict", "A webhook URL must be http(s)");
    }
    assertPublicTarget(parsed);
    sets.push(`url = ${bind(input.url)}`);
  }
  if (input.events !== undefined) sets.push(`events = ${bind(input.events)}`);
  if (input.active !== undefined) sets.push(`active = ${bind(input.active)}`);

  let secret: string | undefined;
  if (input.rotateSecret) {
    secret = `whs_${randomBytes(32).toString("hex")}`;
    sets.push(`secret = ${bind(encryptSecret(secret))}`);
  }

  if (sets.length === 0) {
    // Nothing to change is not an error; return the row as it stands so a
    // caller's optimistic update has something true to settle on.
    const webhook = (await queryOne<Webhook>(
      `SELECT ${WEBHOOK_COLUMNS} FROM workspace_webhook WHERE id = $1`,
      [id]
    ))!;
    return { webhook };
  }

  const webhook = (await queryOne<Webhook>(
    `UPDATE workspace_webhook SET ${sets.join(", ")}
      WHERE id = $1 RETURNING ${WEBHOOK_COLUMNS}`,
    params
  ))!;
  return secret ? { webhook, secret } : { webhook };
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
