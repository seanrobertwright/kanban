import { createHmac } from "node:crypto";

import { query } from "@/shared/db/client";

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
 * a test that wants one calls deliverActivity directly. No retry queue: the
 * last_status telemetry tells an admin it is failing, and a durable delivery
 * log is the same later-work a run-queue drainer is.
 */

const DELIVERY_TIMEOUT_MS = 5_000;

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
      let status = 0; // 0 records "unreachable", distinct from any HTTP answer.
      try {
        const res = await fetch(hook.url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-kanban-event": entry.action,
            // GitHub's convention, which every consumer library speaks.
            "x-kanban-signature-256": `sha256=${createHmac("sha256", hook.secret)
              .update(body)
              .digest("hex")}`,
          },
          body,
          signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
        });
        status = res.status;
      } catch {
        // Unreachable, refused, or timed out — status stays 0.
      }
      await query(
        `UPDATE workspace_webhook
            SET last_status = $2, last_delivery_at = now()
          WHERE id = $1`,
        [hook.id, status]
      );
    })
  );
}
