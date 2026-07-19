import { createHmac } from "node:crypto";
import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getBoard } from "@/features/board/server/repository";
import { createTask } from "@/features/tasks/server/repository";
import {
  ensurePersonalWorkspace,
  getDefaultBoard,
} from "@/features/workspaces/server/repository";
import { pool, query, queryOne } from "@/shared/db/client";
import { deliverActivity } from "./dispatch";
import { createWebhook, deleteWebhook, listWebhooks } from "./repository";

/**
 * Against a real Postgres AND a real HTTP listener, because the feature IS the
 * wire: the payload, the signature header, and the telemetry write are the
 * things a mock would vouch for without proving.
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

// The tests deliver to a listener on 127.0.0.1, which the SSRF gate rightly
// refuses by default — this is the deployment flag doing its documented job.
process.env.WEBHOOK_ALLOW_PRIVATE_NETWORK = "1";

describe("webhooks", () => {
  let alice: string;
  let ws: string;
  let columnId: number;
  let server: Server;
  let port: number;
  const received: { body: string; signature: string; event: string }[] = [];

  beforeAll(async () => {
    alice = await createUser("wh-alice");
    const workspace = await ensurePersonalWorkspace(alice, "WhAlice");
    ws = workspace.id;
    const boardId = (await getDefaultBoard(alice))!.id;
    columnId = (await getBoard(alice, boardId))!.columns[0].id;

    server = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        received.push({
          body,
          signature: String(req.headers["x-kanban-signature-256"] ?? ""),
          event: String(req.headers["x-kanban-event"] ?? ""),
        });
        res.writeHead(204).end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    port = (server.address() as { port: number }).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await query(`DELETE FROM workspace WHERE id = $1`, [ws]);
    await query(`DELETE FROM "user" WHERE id = ANY($1)`, [createdUsers]);
    await pool.end();
  });

  it("delivers a committed activity entry, signed, and records the status", async () => {
    const { webhook, secret } = await createWebhook(alice, ws, {
      url: `http://127.0.0.1:${port}/hook`,
    });
    expect(secret).toMatch(/^whs_/);

    const task = await createTask(alice, { columnId, title: "Hooked" });
    const entry = await queryOne<{ id: string }>(
      `SELECT id FROM activity_log WHERE task_id = $1 AND action = 'task.created'`,
      [task.id]
    );
    await deliverActivity(entry!.id);

    expect(received).toHaveLength(1);
    const delivery = received[0];
    expect(delivery.event).toBe("task.created");
    const expected = `sha256=${createHmac("sha256", secret)
      .update(delivery.body)
      .digest("hex")}`;
    expect(delivery.signature).toBe(expected);
    const payload = JSON.parse(delivery.body) as {
      action: string;
      after: { title: string };
    };
    expect(payload.after.title).toBe("Hooked");

    const row = await queryOne<{ lastStatus: number }>(
      `SELECT last_status AS "lastStatus" FROM workspace_webhook WHERE id = $1`,
      [webhook.id]
    );
    expect(row!.lastStatus).toBe(204);
  });

  it("respects the event filter", async () => {
    const before = received.length;
    await createWebhook(alice, ws, {
      url: `http://127.0.0.1:${port}/filtered`,
      events: ["task.deleted"],
    });

    const task = await createTask(alice, { columnId, title: "Unfiltered" });
    const entry = await queryOne<{ id: string }>(
      `SELECT id FROM activity_log WHERE task_id = $1 AND action = 'task.created'`,
      [task.id]
    );
    await deliverActivity(entry!.id);

    // Only the all-events hook fired; the filtered one stayed quiet.
    const urls = received.slice(before).map((r) => JSON.parse(r.body) as object);
    expect(urls).toHaveLength(1);
  });

  it("an unreachable endpoint records 0, not a crash", async () => {
    const { webhook } = await createWebhook(alice, ws, {
      // A port nothing listens on — connection refused, immediately.
      url: "http://127.0.0.1:1/nowhere",
    });
    const entry = await queryOne<{ id: string }>(
      `SELECT id FROM activity_log ORDER BY id DESC LIMIT 1`
    );
    await deliverActivity(entry!.id);

    const row = await queryOne<{ lastStatus: number | null }>(
      `SELECT last_status AS "lastStatus" FROM workspace_webhook WHERE id = $1`,
      [webhook.id]
    );
    expect(row!.lastStatus).toBe(0);
    await deleteWebhook(alice, webhook.id);
  });

  it("refuses a non-http url and lists without secrets", async () => {
    await expect(
      createWebhook(alice, ws, { url: "ftp://example.com" })
    ).rejects.toThrow(/http/);

    const listed = await listWebhooks(alice, ws);
    expect(listed.length).toBeGreaterThan(0);
    expect(listed.every((w) => !("secret" in w))).toBe(true);
  });

  it("the SSRF gate refuses private and metadata targets when enforced", async () => {
    const flag = process.env.WEBHOOK_ALLOW_PRIVATE_NETWORK;
    delete process.env.WEBHOOK_ALLOW_PRIVATE_NETWORK;
    try {
      for (const url of [
        "http://127.0.0.1/x",
        "http://localhost/x",
        "http://10.1.2.3/x",
        "http://192.168.1.1/x",
        "http://172.16.0.9/x",
        "http://169.254.169.254/latest/meta-data",
        "http://[::1]/x",
      ]) {
        await expect(createWebhook(alice, ws, { url })).rejects.toThrow(
          /private or internal/
        );
      }
      // A public literal is still welcome.
      const { webhook } = await createWebhook(alice, ws, {
        url: "https://example.com/hook",
      });
      await deleteWebhook(alice, webhook.id);
    } finally {
      process.env.WEBHOOK_ALLOW_PRIVATE_NETWORK = flag;
    }
  });
});
