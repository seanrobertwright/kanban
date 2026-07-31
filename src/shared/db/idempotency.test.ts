import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createAgent } from "@/features/agents/server/admin";
import { getBoard } from "@/features/board/server/repository";
import {
  ensurePersonalWorkspace,
  getDefaultBoard,
} from "@/features/workspaces/server/repository";
import { handleCreateTask } from "@/features/tasks/server/handlers";
import { pool, query } from "@/shared/db/client";
import { IDEMPOTENCY_HEADER, withIdempotency } from "./idempotency";

/**
 * Exactly-once creates (§4.4 item 3), against the real database, through the
 * real create handler.
 *
 * Real-DB because the mechanism *is* a database property: the primary key is
 * what makes two simultaneous retries mutually exclusive, and the in-flight
 * marker only means anything if the row is visible to the second caller. A test
 * with a stubbed store would assert the branch structure and prove none of that.
 *
 * The load-bearing assertion in almost every case is a COUNT of the tasks that
 * actually exist — the failure this closes is a duplicate, and a duplicate is
 * invisible in a response body.
 */

const createdUsers: string[] = [];

async function createUser(label: string): Promise<string> {
  const id = `test-${label}-${randomUUID()}`;
  await query(
    `INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, true)`,
    [id, `Test ${label}`, `${id}@example.test`]
  );
  createdUsers.push(id);
  return id;
}

describe("withIdempotency", () => {
  let alice: string;
  let token: string;
  let secondToken: string;
  let botId: string;
  let columnId: number;

  function post(body: unknown, key: string | null, agentKey = token): Request {
    return new Request("http://test/api/tasks", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-agent-key": agentKey,
        ...(key ? { [IDEMPOTENCY_HEADER]: key } : {}),
      },
      body: JSON.stringify(body),
    });
  }

  /** The wiring exactly as the route does it. */
  const send = (request: Request) =>
    withIdempotency(request, () => handleCreateTask(request));

  const countTitled = async (title: string) =>
    Number(
      (
        await query<{ n: string }>(
          `SELECT count(*) AS n FROM task WHERE title = $1`,
          [title]
        )
      )[0].n
    );

  beforeAll(async () => {
    alice = await createUser("idem-alice");
    const ws = await ensurePersonalWorkspace(alice, "IdemAlice");
    const boardId = (await getDefaultBoard(alice))!.id;
    columnId = (await getBoard(alice, boardId))!.columns[0].id;

    const bot = await createAgent(alice, ws.id, {
      name: "Idem Bot",
      role: "member",
      kind: "external",
    });
    token = bot.token!;
    botId = bot.agent.id;
    const other = await createAgent(alice, ws.id, {
      name: "Other Bot",
      role: "member",
      kind: "external",
    });
    secondToken = other.token!;

    // create_task is changeset-tier for an agent by default (012), and a held
    // proposal writes no task — which would make every duplicate-count assertion
    // below vacuously pass. The approval policy is the supported way to say "this
    // agent may do this one directly", so these agents are given it; the
    // interaction with a *held* create is asserted on its own further down, with
    // an agent left on the default.
    await query(
      `UPDATE agent SET approval_policy = '{"create_task":"auto"}'::jsonb
        WHERE id = ANY($1)`,
      [[botId, other.agent.id]]
    );
  });

  afterAll(async () => {
    await query(
      `DELETE FROM workspace w WHERE EXISTS (
         SELECT 1 FROM workspace_member m WHERE m.workspace_id = w.id AND m.user_id = ANY($1))`,
      [createdUsers]
    );
    await query(`DELETE FROM "user" WHERE id = ANY($1)`, [createdUsers]);
    await pool.end();
  });

  it("creates twice without a key — the behaviour every caller had before", async () => {
    const body = { columnId, title: "Unkeyed create" };
    await send(post(body, null));
    await send(post(body, null));
    expect(await countTitled("Unkeyed create")).toBe(2);
  });

  it("creates once and replays the same answer for a repeated key", async () => {
    const key = randomUUID();
    const body = { columnId, title: "Keyed create" };

    const first = await send(post(body, key));
    const second = await send(post(body, key));

    expect(await countTitled("Keyed create")).toBe(1);
    expect(second.status).toBe(first.status);
    expect(await second.json()).toEqual(await first.json());
    // The replay is labelled, so a caller can tell "already done" from "done now".
    expect(second.headers.get("idempotent-replay")).toBe("true");
  });

  it("refuses a key reused for different content instead of dropping the change", async () => {
    const key = randomUUID();
    await send(post({ columnId, title: "First content" }, key));
    const res = await send(post({ columnId, title: "Different content" }, key));

    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("CONFLICT_IDEMPOTENCY_KEY");
    // The loud answer is the point: the second change is refused, not silently
    // swallowed by replaying the first response.
    expect(await countTitled("Different content")).toBe(0);
  });

  it("scopes keys per principal — two agents may pick the same key", async () => {
    const key = randomUUID();
    const body = { columnId, title: "Shared key" };
    const mine = await send(post(body, key));
    const theirs = await send(post(body, key, secondToken));

    expect(mine.status).toBe(201);
    expect(theirs.status).toBe(201);
    expect(await countTitled("Shared key")).toBe(2);
  });

  it("tells a caller its own earlier attempt is still running", async () => {
    // The actual race, not a hand-seeded row: two retries of the same create
    // overlapping, which is exactly what a client that timed out and tried again
    // produces. The first is held mid-flight so the second arrives while it is
    // still running — the case a cache written on the way out cannot catch,
    // because both attempts would find nothing and both would write.
    const key = randomUUID();
    const body = { columnId, title: "Raced create" };
    const inFlight = post(body, key);
    const retry = post(body, key);

    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = withIdempotency(inFlight, async () => {
      await held;
      return handleCreateTask(inFlight);
    });
    await new Promise((resolve) => setTimeout(resolve, 50));

    const second = await withIdempotency(retry, () => handleCreateTask(retry));
    expect(second.status).toBe(409);
    expect((await second.json()).code).toBe("IDEMPOTENCY_IN_PROGRESS");

    release();
    expect((await first).status).toBe(201);
    expect(await countTitled("Raced create")).toBe(1);
  });

  it("does not remember a failure — the retry is the whole point", async () => {
    const key = randomUUID();
    const boom = new Request("http://test/api/tasks", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-agent-key": token,
        [IDEMPOTENCY_HEADER]: key,
      },
      body: JSON.stringify({ columnId, title: "Recovered create" }),
    });

    await expect(
      withIdempotency(boom, async () => {
        throw new Error("the database went away mid-write");
      })
    ).rejects.toThrow("went away");

    // Same key, same body: the row was released, so this runs rather than
    // replaying a failure forever.
    const res = await send(post({ columnId, title: "Recovered create" }, key));
    expect(res.status).toBe(201);
    expect(await countTitled("Recovered create")).toBe(1);
  });

  it("remembers a 4xx, which is a real answer about the request", async () => {
    const key = randomUUID();
    const bad = { columnId, title: "" };
    const first = await send(post(bad, key));
    const second = await send(post(bad, key));

    expect(first.status).toBe(400);
    expect(second.status).toBe(400);
    expect(second.headers.get("idempotent-replay")).toBe("true");
  });

  it("takes over a key past its TTL rather than being wedged by it", async () => {
    const key = randomUUID();
    const body = { columnId, title: "Recycled key" };
    await send(post(body, key));
    await query(
      `UPDATE idempotency_key SET created_at = now() - interval '48 hours' WHERE key = $1`,
      [key]
    );

    const res = await send(post(body, key));
    expect(res.status).toBe(201);
    expect(await countTitled("Recycled key")).toBe(2);
  });

  it("does not propose the same change twice when the gate holds it", async () => {
    // An agent on the default policy: create_task is changeset-tier, so the
    // answer is a 202 naming a changeset rather than a task. A retry without a
    // key would leave a human two identical proposals to review — the duplicate
    // this mechanism is for, in the shape this app actually produces it.
    const held = await createAgent(alice, (await getDefaultBoard(alice))!.workspaceId, {
      name: "Gated Bot",
      role: "member",
      kind: "external",
    });
    const key = randomUUID();
    const body = { columnId, title: "Held create" };

    const first = await send(post(body, key, held.token!));
    const second = await send(post(body, key, held.token!));

    expect(first.status).toBe(202);
    const firstBody = (await first.json()) as { changesetId: string };
    const secondBody = (await second.json()) as { changesetId: string };
    expect(secondBody.changesetId).toBe(firstBody.changesetId);
    expect(second.headers.get("idempotent-replay")).toBe("true");
    expect(await countTitled("Held create")).toBe(0);
  });

  it("refuses a key too short to be a real one", async () => {
    const res = await send(post({ columnId, title: "Short key" }, "abc"));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("INVALID_IDEMPOTENCY_KEY");
    expect(await countTitled("Short key")).toBe(0);
  });
});
