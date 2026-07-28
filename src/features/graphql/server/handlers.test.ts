import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createAgent } from "@/features/agents/server/admin";
import { getBoard } from "@/features/board/server/repository";
import { createTask } from "@/features/tasks/server/repository";
import {
  ensurePersonalWorkspace,
  getDefaultBoard,
} from "@/features/workspaces/server/repository";
import { pool, query } from "@/shared/db/client";
import { resetRateLimits, takeToken } from "@/shared/lib/rate-limit";
import { MAX_QUERY_BYTES, MAX_ROOT_FIELDS } from "./limits";
import { handleGraphQL } from "./handlers";

/**
 * The GraphQL ingress (2.9), through the handler with a real agent key — the
 * handler *is* the policy here: auth, the rate limit, the body ceilings, and the
 * status-code split that the guard rails made necessary.
 *
 * That split is the thing worth testing rather than asserting in a comment:
 * a request that never executed is a 4xx, and a request that executed and had a
 * resolver refuse is a 200 carrying `errors`. Collapsing the two would either
 * turn every permission answer into a failed request, or hand a rejected query
 * back as if it had succeeded.
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

function gqlRequest(body: unknown, token?: string): Request {
  return new Request("http://test/api/graphql", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { "x-agent-key": token } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("handleGraphQL", () => {
  let alice: string;
  let token: string;
  let agentId: string;
  let boardId: number;
  let taskId: number;
  let strangersBoard: number;

  beforeAll(async () => {
    alice = await createUser("gqlh-alice");
    const ws = await ensurePersonalWorkspace(alice, "GqlhAlice");
    boardId = (await getDefaultBoard(alice))!.id;
    const columnId = (await getBoard(alice, boardId))!.columns[0].id;
    taskId = (await createTask(alice, { columnId, title: "Ingress me" })).id;

    const minted = await createAgent(alice, ws.id, {
      name: "Query Bot",
      role: "member",
      kind: "external",
    });
    token = minted.token!;
    agentId = minted.agent.id;

    const bob = await createUser("gqlh-bob");
    await ensurePersonalWorkspace(bob, "GqlhBob");
    strangersBoard = (await getDefaultBoard(bob))!.id;
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

  // Each test starts with a full bucket, so the 429 case is the only one that
  // has to think about the limiter.
  beforeEach(() => resetRateLimits());

  it("requires a principal", async () => {
    const res = await handleGraphQL(gqlRequest({ query: "{ board(id: 1) { id } }" }));
    expect(res.status).toBe(401);
  });

  it("answers a well-formed query as the agent", async () => {
    const res = await handleGraphQL(
      gqlRequest(
        { query: "query ($id: Int!) { task(id: $id) { id title } }", variables: { id: taskId } },
        token
      )
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { task: { title: string } }; errors?: unknown };
    expect(body.errors).toBeUndefined();
    expect(body.data.task.title).toBe("Ingress me");
  });

  it("returns 200 with errors when a resolver refuses — the query was fine", async () => {
    const res = await handleGraphQL(
      gqlRequest(
        { query: "query ($id: Int!) { board(id: $id) { id name } }", variables: { id: strangersBoard } },
        token
      )
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { board: unknown } | null; errors: unknown[] };
    expect(body.errors.length).toBeGreaterThan(0);
    expect(body.data?.board ?? null).toBeNull();
  });

  it("rejects alias amplification with a 400 and a limit code", async () => {
    const aliases = Array.from(
      { length: MAX_ROOT_FIELDS + 5 },
      (_, i) => `a${i}: board(id: ${i + 1}) { id }`
    ).join("\n");
    const res = await handleGraphQL(gqlRequest({ query: `{ ${aliases} }` }, token));
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      data?: unknown;
      errors: { message: string; extensions?: { code?: string } }[];
    };
    expect(body.data).toBeUndefined();
    expect(body.errors[0].extensions?.code).toBe("QUERY_LIMIT_EXCEEDED");
  });

  it("rejects a query that fails schema validation with a 400", async () => {
    const res = await handleGraphQL(gqlRequest({ query: "{ board(id: 1) { nope } }" }, token));
    expect(res.status).toBe(400);
  });

  it("rejects a syntactically broken query with a 400", async () => {
    const res = await handleGraphQL(gqlRequest({ query: "{ board(id: 1) {" }, token));
    expect(res.status).toBe(400);
  });

  it("rejects an oversized query before parsing it", async () => {
    const padding = "a".repeat(MAX_QUERY_BYTES);
    const res = await handleGraphQL(
      gqlRequest({ query: `{ board(id: 1) { id } } # ${padding}` }, token)
    );
    expect(res.status).toBe(413);
  });

  it("rejects an oversized body on its declared length", async () => {
    // The cheap ceiling: no body is read at all, so a caller cannot make the
    // server buffer a megabyte before finding out it is too big.
    const request = new Request("http://test/api/graphql", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": String(MAX_QUERY_BYTES * 100),
        "x-agent-key": token,
      },
      body: JSON.stringify({ query: "{ board(id: 1) { id } }" }),
    });
    expect((await handleGraphQL(request)).status).toBe(413);
  });

  it("requires a query in the body", async () => {
    expect((await handleGraphQL(gqlRequest({ variables: {} }, token))).status).toBe(400);
  });

  it("rate limits a principal that outruns its bucket", async () => {
    // Drained through the limiter directly rather than by firing sixty requests:
    // the key is the principal's identity, which is exactly what the handler
    // derives, and the point of the test is the 61st request, not the first 60.
    const key = `graphql:agent:${agentId}`;
    for (let i = 0; i < 60; i++) takeToken(key, { capacity: 60, refillPerSecond: 1 });

    const res = await handleGraphQL(gqlRequest({ query: "{ board(id: 1) { id } }" }, token));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
  });
});
