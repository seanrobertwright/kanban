import { createHmac } from "node:crypto";

import { query } from "@/shared/db/client";
import { decryptSecret, isEncrypted } from "@/shared/crypto/secret-box";

/**
 * Delivery — the activity stream crossing the process boundary (025).
 *
 * queueDelivery is called from logActivity, which runs *inside* a caller's
 * transaction; the callback runs via Next's after(), which fires once the
 * response is sent — after commit. The window that leaves open is a rollback
 * after the log write, so deliverActivity re-reads the entry first and
 * delivers nothing that never committed: the SELECT is the receipt.
 *
 * Best-effort beyond that, dispatchRun's contract: outside a request scope
 * (a test, a script) after() throws and the delivery simply does not happen —
 * a test that wants one calls deliverActivity directly.
 *
 * Since 082 the attempt is *recorded* whether or not it succeeds. Each
 * (webhook, activity) pair gets one durable row, which is what makes delivery
 * idempotent under a double-queued callback and what lets a failed attempt be
 * tried again later by drainWebhookDeliveries. The row is claimed before the
 * request goes out, so two app instances racing the same event settle it in the
 * database rather than both POSTing it.
 */

const DELIVERY_TIMEOUT_MS = 5_000;

/**
 * How many times an event is offered to a failing endpoint before it is written
 * off. Five attempts on the backoff below spans a bit over an hour, which
 * covers a deploy or a restart without keeping a permanently dead subscriber's
 * queue alive forever. The write-off is a `failed` row, not a deletion — the
 * admin can see exactly which events a broken endpoint missed.
 */
const MAX_ATTEMPTS = 5;

/** Exponential backoff in seconds, indexed by the attempt just completed. */
const BACKOFF_SECONDS = [60, 300, 900, 3600];

/**
 * Whether a failure is worth trying again.
 *
 * A 4xx means the subscriber understood the request and rejected it — the same
 * payload will be rejected again in an hour, so retrying only wastes both
 * sides' capacity. 408 and 429 are the two 4xx exceptions that are genuinely
 * about *now* rather than about the request. Everything else — unreachable
 * (status 0), any 5xx — is transient until proven otherwise.
 */
function isRetryable(status: number): boolean {
  if (status === 0) return true;
  if (status === 408 || status === 429) return true;
  return status >= 500;
}

interface ActivityRow {
  id: string;
  workspaceId: string;
  boardId: number | null;
  taskId: number | null;
  actorType: string;
  actorId: string;
  action: string;
  before: unknown;
  after: unknown;
  createdAt: string;
}

interface WebhookRow {
  id: number;
  url: string;
  secret: string;
}

function deliverySecret(value: string): string {
  // Legacy rows are rewritten at startup. Refuse to interpret malformed v1
  // values as plaintext: an AEAD failure must fail closed, not silently sign
  // with attacker-controlled bytes.
  return isEncrypted(value) ? decryptSecret(value) : value;
}

export function queueDelivery(activityId: string): void {
  void (async () => {
    try {
      const { after } = await import("next/server");
      after(() => deliverActivity(activityId));
    } catch {
      // No request scope — no delivery. See the module comment.
    }
  })();
}

export async function deliverActivity(activityId: string): Promise<void> {
  // The receipt: only a committed entry can be read back.
  const entries = await query<ActivityRow>(
    `SELECT id, workspace_id AS "workspaceId", board_id AS "boardId",
            task_id AS "taskId", actor_type AS "actorType",
            actor_id AS "actorId", action, before, after,
            created_at AS "createdAt"
       FROM activity_log WHERE id = $1`,
    [activityId]
  );
  const entry = entries[0];
  if (!entry) return;

  const hooks = await query<WebhookRow>(
    `SELECT id, url, secret FROM workspace_webhook
      WHERE workspace_id = $1 AND active
        AND (events = '{}' OR $2 = ANY(events))`,
    [entry.workspaceId, entry.action]
  );
  if (hooks.length === 0) return;

  const body = JSON.stringify(entry);
  await Promise.all(
    hooks.map(async (hook) => {
      // Claim the pair first. ON CONFLICT DO NOTHING means the second caller for
      // the same (webhook, activity) — a re-queued after(), a second instance —
      // gets no row back and sends nothing, which is the whole idempotency
      // story in one statement.
      const claimed = await query<{ id: string }>(
        `INSERT INTO webhook_delivery (webhook_id, activity_id, action)
         VALUES ($1, $2, $3)
         ON CONFLICT (webhook_id, activity_id) DO NOTHING
         RETURNING id::text`,
        [hook.id, entry.id, entry.action]
      );
      if (!claimed[0]) return;
      await attempt(hook, claimed[0].id, body, entry.action);
    })
  );
}

/**
 * One delivery attempt, and the bookkeeping that follows it.
 *
 * Both surfaces are written together and deliberately: the webhook row's
 * last_status is what an admin's list shows at a glance, and the delivery row
 * is what says which event that status was about. They agreed by accident
 * before 082 because there was only ever one attempt; now they agree because
 * this function is the only thing that writes either.
 */
async function attempt(
  hook: WebhookRow,
  deliveryId: string,
  body: string,
  action: string
): Promise<void> {
  let status = 0; // 0 records "unreachable", distinct from any HTTP answer.
  let error: string | null = null;
  try {
    const res = await fetch(hook.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-kanban-event": action,
        // GitHub's convention, which every consumer library speaks.
        "x-kanban-signature-256": `sha256=${createHmac("sha256", deliverySecret(hook.secret))
          .update(body)
          .digest("hex")}`,
      },
      body,
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    });
    status = res.status;
    if (!res.ok) error = `HTTP ${res.status}`;
  } catch (cause) {
    error = cause instanceof Error ? cause.message : "Request failed";
  }

  const delivered = status >= 200 && status < 300;
  // The status is decided in SQL rather than here because `attempts` is read
  // and written in the same statement: another instance may have attempted this
  // row since it was claimed, and the budget must be spent against the true
  // count, not the one this process last saw.
  await query(
    `UPDATE webhook_delivery
        SET attempts = attempts + 1,
            last_status = $2,
            last_error = $3,
            status = CASE
              WHEN $4 THEN 'delivered'
              WHEN $5 AND attempts + 1 < $6 THEN 'pending'
              ELSE 'failed'
            END,
            next_attempt_at = now() + make_interval(
              secs => ($7::int[])[LEAST(attempts + 1, array_length($7::int[], 1))]),
            updated_at = now()
      WHERE id = $1::bigint`,
    [
      deliveryId,
      status,
      error?.slice(0, 500) ?? null,
      delivered,
      isRetryable(status),
      MAX_ATTEMPTS,
      BACKOFF_SECONDS,
    ]
  );
  await query(
    `UPDATE workspace_webhook
        SET last_status = $2, last_delivery_at = now()
      WHERE id = $1`,
    [hook.id, status]
  );
}

/**
 * Retry every delivery whose backoff has elapsed. Returns how many it tried.
 *
 * Called by a scheduler — a cron hitting a route, a worker loop — rather than
 * running itself on a timer inside the web process, because a timer in a
 * serverless process is a timer that may never fire and, on a long-lived one,
 * is N timers when N instances are up. An explicit drainer has one caller and
 * an obvious failure mode.
 *
 * The claim is a *lease*, not a row lock. A row lock taken by a SELECT ... FOR
 * UPDATE outside a transaction is released the instant that statement ends —
 * which is before a single HTTP request goes out — so it would protect nothing.
 * Instead the UPDATE pushes each claimed row's next_attempt_at forward, taking
 * it out of the due window while this drainer works on it. A second drainer
 * sees no due rows; a crashed drainer's rows simply come due again. SKIP LOCKED
 * on the inner SELECT keeps two concurrent claims from waiting on each other.
 */
export async function drainWebhookDeliveries(limit = 50): Promise<number> {
  const due = await query<{
    id: string;
    activityId: string;
    action: string;
    hookId: number;
    url: string;
    secret: string;
  }>(
    `UPDATE webhook_delivery d
        SET next_attempt_at = now() + interval '5 minutes', updated_at = now()
       FROM workspace_webhook w
      WHERE w.id = d.webhook_id
        AND d.id IN (
          SELECT id FROM webhook_delivery
           WHERE status = 'pending' AND next_attempt_at <= now()
           ORDER BY next_attempt_at
           LIMIT $1
           FOR UPDATE SKIP LOCKED)
        AND w.active
     RETURNING d.id::text, d.activity_id::text AS "activityId", d.action,
               w.id AS "hookId", w.url, w.secret`,
    [limit]
  );
  if (due.length === 0) return 0;

  for (const row of due) {
    const entries = await query<ActivityRow>(
      `SELECT id, workspace_id AS "workspaceId", board_id AS "boardId",
              task_id AS "taskId", actor_type AS "actorType",
              actor_id AS "actorId", action, before, after,
              created_at AS "createdAt"
         FROM activity_log WHERE id = $1`,
      [row.activityId]
    );
    if (!entries[0]) {
      // Retention took the source entry (064). There is nothing left to send,
      // and pretending otherwise would deliver an empty body — mark it done
      // rather than retrying an event that no longer exists.
      await query(
        `UPDATE webhook_delivery
            SET status = 'failed', last_error = 'Activity entry no longer exists',
                updated_at = now()
          WHERE id = $1::bigint`,
        [row.id]
      );
      continue;
    }
    await attempt(
      { id: row.hookId, url: row.url, secret: row.secret },
      row.id,
      JSON.stringify(entries[0]),
      row.action
    );
  }
  return due.length;
}

/** A webhook's recent delivery history, newest first — the admin's answer to
 *  "which events did this endpoint actually get". */
export async function listDeliveries(webhookId: number, limit = 50) {
  return query<{
    id: string;
    action: string;
    attempts: number;
    lastStatus: number | null;
    lastError: string | null;
    status: string;
    nextAttemptAt: string;
    createdAt: string;
  }>(
    `SELECT id::text, action, attempts, last_status AS "lastStatus",
            last_error AS "lastError", status,
            next_attempt_at AS "nextAttemptAt", created_at AS "createdAt"
       FROM webhook_delivery
      WHERE webhook_id = $1
      ORDER BY created_at DESC, id DESC
      LIMIT $2`,
    [webhookId, limit]
  );
}
