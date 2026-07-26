import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { getBoard } from "@/features/board/server/repository";
import { createTask } from "@/features/tasks/server/repository";
import {
  ensurePersonalWorkspace,
  getDefaultBoard,
} from "@/features/workspaces/server/repository";
import { pool, query, queryOne } from "@/shared/db/client";
import {
  deliverActivity,
  drainWebhookDeliveries,
  listDeliveries,
} from "./dispatch";
import { createWebhook, updateWebhook } from "./repository";

/**
 * The durability half of webhooks (082): the delivery log, the retry, and the
 * edit path. Against a real Postgres and a real listener for webhooks.test.ts's
 * reason — the claim is about what survives a failure, and a mock that never
 * really fails cannot show it.
 */

const createdUsers: string[] = [];

async function createUser(label: string): Promise<string> {
  const id = `test-${label}-${randomUUID()}`;
  await query(
    `INSERT INTO "user" (id, name, email, "emailVerified")
     VALUES ($1, $2, $3, true)`,
    [id, `Test ${label}`, `${id}@example.test`]
  );
  createdUsers.push(id);
  return id;
}

process.env.WEBHOOK_ALLOW_PRIVATE_NETWORK = "1";

describe("webhook delivery log", () => {
  let alice: string;
  let ws: string;
  let columnId: number;
  let server: Server;
  let port: number;
  /** Flipped per test to make the listener succeed, fail, or fail-then-heal. */
  let respondWith = 204;
  /** Hits per path. Every webhook in a workspace gets every event, so a
   *  single counter would attribute an earlier test's deliveries to this one. */
  const hits = new Map();

  beforeAll(async () => {
    alice = await createUser("whd-alice");
    ws = (await ensurePersonalWorkspace(alice, "WhdAlice")).id;
    const boardId = (await getDefaultBoard(alice))!.id;
    columnId = (await getBoard(alice, boardId))!.columns[0].id;

    server = createServer((req, res) => {
      req.on("data", () => {});
      req.on("end", () => {
        const path = req.url ?? "";
        hits.set(path, (hits.get(path) ?? 0) + 1);
        res.writeHead(respondWith).end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    port = (server.address() as { port: number }).port;
  });

  // Every webhook in a workspace receives every event, and drainWebhookDeliveries
  // drains the whole due queue — so a webhook left standing from an earlier test
  // would silently join the next one's counts. Deleting it takes its delivery
  // rows with it (ON DELETE CASCADE).
  afterEach(async () => {
    await query(`DELETE FROM workspace_webhook WHERE workspace_id = $1`, [ws]);
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await query(`DELETE FROM workspace WHERE id = $1`, [ws]);
  });

  /** An activity entry to deliver, and the id of the row it wrote. */
  async function anEvent(): Promise<string> {
    const task = await createTask(alice, { columnId, title: `Event ${randomUUID()}` });
    const row = await queryOne<{ id: string }>(
      `SELECT id::text FROM activity_log
        WHERE task_id = $1 ORDER BY id DESC LIMIT 1`,
      [task.id]
    );
    return row!.id;
  }

  it("records a successful delivery once, and never sends it twice", async () => {
    respondWith = 204;
    const { webhook } = await createWebhook(alice, ws, {
      url: `http://127.0.0.1:${port}/ok`,
    });
    const activityId = await anEvent();

    await deliverActivity(activityId);
    // The same entry queued again — a re-fired after(), or a second instance.
    await deliverActivity(activityId);

    expect(hits.get("/ok")).toBe(1);
    const log = await listDeliveries(webhook.id);
    expect(log).toHaveLength(1);
    expect(log[0].status).toBe("delivered");
    expect(log[0].attempts).toBe(1);
    expect(log[0].lastStatus).toBe(204);
  });

  it("keeps a failed delivery pending, then sends it when the endpoint heals", async () => {
    respondWith = 503;
    const { webhook } = await createWebhook(alice, ws, {
      url: `http://127.0.0.1:${port}/flaky`,
    });
    const activityId = await anEvent();

    await deliverActivity(activityId);
    let log = await listDeliveries(webhook.id);
    expect(log[0].status).toBe("pending");
    expect(log[0].lastError).toBe("HTTP 503");

    // The drainer only takes rows whose backoff has elapsed, so nothing is due
    // yet — this is the backoff working, not a missed row.
    expect(await drainWebhookDeliveries()).toBe(0);

    // Fast-forward the backoff rather than sleeping a minute.
    await query(
      `UPDATE webhook_delivery SET next_attempt_at = now() - interval '1 minute'
        WHERE webhook_id = $1`,
      [webhook.id]
    );
    respondWith = 200;
    expect(await drainWebhookDeliveries()).toBe(1);

    log = await listDeliveries(webhook.id);
    expect(log[0].status).toBe("delivered");
    expect(log[0].attempts).toBe(2);
    expect(hits.get("/flaky")).toBe(2);
  });

  it("gives up on a 4xx instead of retrying a request that will be rejected again", async () => {
    respondWith = 400;
    const { webhook } = await createWebhook(alice, ws, {
      url: `http://127.0.0.1:${port}/rejects`,
    });
    await deliverActivity(await anEvent());

    const log = await listDeliveries(webhook.id);
    expect(log[0].status).toBe("failed");
    expect(log[0].attempts).toBe(1);
  });

  it("stops retrying after the attempt budget and leaves the event visible", async () => {
    respondWith = 500;
    const { webhook } = await createWebhook(alice, ws, {
      url: `http://127.0.0.1:${port}/broken`,
    });
    await deliverActivity(await anEvent());

    // Five attempts total: the first above, then four drains with the backoff
    // wound forward each time.
    for (let i = 0; i < 4; i += 1) {
      await query(
        `UPDATE webhook_delivery SET next_attempt_at = now() - interval '1 minute'
          WHERE webhook_id = $1`,
        [webhook.id]
      );
      await drainWebhookDeliveries();
    }

    const log = await listDeliveries(webhook.id);
    expect(log[0].attempts).toBe(5);
    expect(log[0].status).toBe("failed");
    // Written off, not deleted — the admin can still see which event was lost.
    expect(log[0].action).toBeTruthy();
  });

  it("skips a paused webhook's queue without discarding it", async () => {
    respondWith = 503;
    const { webhook } = await createWebhook(alice, ws, {
      url: `http://127.0.0.1:${port}/paused`,
    });
    await deliverActivity(await anEvent());
    await updateWebhook(alice, webhook.id, { active: false });
    await query(
      `UPDATE webhook_delivery SET next_attempt_at = now() - interval '1 minute'
        WHERE webhook_id = $1`,
      [webhook.id]
    );

    expect(await drainWebhookDeliveries()).toBe(0);
    const log = await listDeliveries(webhook.id);
    expect(log[0].status).toBe("pending");
  });
});

describe("editing a webhook", () => {
  let alice: string;
  let ws: string;

  beforeAll(async () => {
    alice = await createUser("whe-alice");
    ws = (await ensurePersonalWorkspace(alice, "WheAlice")).id;
  });

  afterAll(async () => {
    await query(`DELETE FROM workspace WHERE id = $1`, [ws]);
    await query(`DELETE FROM "user" WHERE id = ANY($1)`, [createdUsers]);
    // The pool is the module's, shared by both suites — the last one closes it.
    await pool.end();
  });

  it("narrows the filter and pauses without touching the secret", async () => {
    const { webhook, secret } = await createWebhook(alice, ws, {
      url: "https://example.test/hook",
    });
    const result = await updateWebhook(alice, webhook.id, {
      events: ["task.created"],
      active: false,
    });
    expect(result!.webhook.events).toEqual(["task.created"]);
    expect(result!.webhook.active).toBe(false);
    // No rotation was asked for, so none happened — the subscriber's existing
    // secret still verifies.
    expect(result!.secret).toBeUndefined();
    expect(secret).toMatch(/^whs_/);
  });

  it("rotates the secret only when asked, and shows it once", async () => {
    const { webhook, secret } = await createWebhook(alice, ws, {
      url: "https://example.test/rotate",
    });
    const rotated = await updateWebhook(alice, webhook.id, { rotateSecret: true });
    expect(rotated!.secret).toMatch(/^whs_/);
    expect(rotated!.secret).not.toBe(secret);
    // The read path never carries it back.
    expect((rotated!.webhook as unknown as Record<string, unknown>).secret).toBeUndefined();
  });

  it("applies the SSRF gate to an edited URL, not only a created one", async () => {
    const { webhook } = await createWebhook(alice, ws, {
      url: "https://example.test/safe",
    });
    delete process.env.WEBHOOK_ALLOW_PRIVATE_NETWORK;
    await expect(
      updateWebhook(alice, webhook.id, { url: "http://169.254.169.254/latest/meta-data/" })
    ).rejects.toMatchObject({ kind: "conflict" });
    process.env.WEBHOOK_ALLOW_PRIVATE_NETWORK = "1";
  });

  it("answers not-found for a webhook that is not there", async () => {
    expect(await updateWebhook(alice, 999_999_999, { active: false })).toBeUndefined();
  });
});
