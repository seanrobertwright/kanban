import { timingSafeEqual } from "node:crypto";

import { sweepRetention } from "@/features/admin/server/retention-sweeper";
import { drainWebhookDeliveries } from "@/features/webhooks/server/dispatch";

export const dynamic = "force-dynamic";

/**
 * The scheduled-work door: `POST /api/maintenance`, called by a cron.
 *
 * Two jobs existed with no caller at all before this. The retention sweeper
 * (064) applied each workspace's retention policies, and the webhook drainer
 * (082) retries deliveries whose backoff has elapsed — both correct, both never
 * running, which made "retention is configured" and "the delivery will be
 * retried" two promises the app was quietly not keeping.
 *
 * A route rather than a timer inside the web process, for the reason the
 * drainer's own comment gives: a timer in a serverless process may never fire,
 * and on a long-lived one it is N timers when N instances are up. A cron
 * calling a URL has one caller and an obvious failure mode — it stops, and the
 * response body says what did and did not happen.
 *
 *   curl -X POST -H "authorization: Bearer $MAINTENANCE_TOKEN" \
 *        https://your-app/api/maintenance
 *
 * Refused outright when MAINTENANCE_TOKEN is unset. This endpoint deletes data
 * under retention policy, so an unconfigured deployment must answer 404 and not
 * "sure, run it" — a maintenance door that opens for anyone is a delete button
 * for anyone.
 */
export async function POST(request: Request) {
  const expected = process.env.MAINTENANCE_TOKEN;
  if (!expected) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const offered = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  // Compared over equal-length buffers so the comparison cannot leak the
  // token's length, and timing-safe so it cannot leak its prefix.
  const a = Buffer.from(offered.padEnd(expected.length).slice(0, expected.length));
  const b = Buffer.from(expected);
  if (offered.length !== expected.length || !timingSafeEqual(a, b)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Each job is reported separately and neither can take the other down: a
  // failing sweep must not stop deliveries being retried, and a cron that gets
  // a 500 learns nothing about which half worked.
  const result: Record<string, unknown> = {};
  try {
    result.deliveriesAttempted = await drainWebhookDeliveries();
  } catch (error) {
    result.deliveryError = error instanceof Error ? error.message : "failed";
  }
  try {
    await sweepRetention();
    result.retentionSwept = true;
  } catch (error) {
    result.retentionError = error instanceof Error ? error.message : "failed";
  }
  return Response.json(result);
}
