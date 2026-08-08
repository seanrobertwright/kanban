import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * The session seam, faked the way dry-run.test.ts fakes it: a unit test cannot
 * mint a better-auth cookie, so `x-test-user` stands in for one. Everything
 * else — the key lookup, the principal resolution, the handlers — runs real,
 * against the real database.
 */
vi.mock("@/features/auth/server/session", async (importOriginal) => {
  const original = await importOriginal<
    typeof import("@/features/auth/server/session")
  >();
  return {
    ...original,
    getSessionFromRequest: async (request: Request) => {
      const user = request.headers.get("x-test-user");
      return user ? { user: { id: user } } : null;
    },
  };
});

import { handleListNotifications } from "@/features/activity/server/handlers";
import { getPrincipalFromRequest } from "./agent-auth";
import { getUserByApiKey } from "./user-key";
import {
  createUserApiKey,
  deleteUserApiKey,
  listUserApiKeys,
} from "./user-key-admin";
import {
  handleCreateUserApiKey,
  handleDeleteUserApiKey,
  handleListUserApiKeys,
} from "./user-key-handlers";
import { ensurePersonalWorkspace } from "@/features/workspaces/server/repository";
import { pool, query } from "@/shared/db/client";

/**
 * The personal API key (094): a human credential for headless callers.
 *
 * The properties under test are the ones the design leans on:
 *  1. a key resolves to its owner as a HUMAN principal — same kind a cookie
 *     yields, so every role check downstream is the cookie's;
 *  2. only the hash is stored, and the raw token appears exactly once;
 *  3. key management is session-only — a key must not mint keys;
 *  4. ownership is the scope: one user's keys are invisible to another;
 *  5. a human-only handler (notifications) now accepts the key.
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

describe("personal API keys", () => {
  let alice: string;
  let bob: string;
  let workspaceId: string;

  beforeAll(async () => {
    alice = await createUser("alice");
    bob = await createUser("bob");
    workspaceId = (await ensurePersonalWorkspace(alice, "Alice")).id;
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

  it("mints a kbu_ token, stores only its hash, and resolves it to a human principal", async () => {
    const { key, token } = await createUserApiKey(alice, "laptop");
    expect(token).toMatch(/^kbu_[0-9a-f]{64}$/);

    const row = await query<{ token_hash: string }>(
      `SELECT token_hash FROM user_api_key WHERE id = $1`,
      [key.id]
    );
    expect(row[0].token_hash).not.toContain(token);

    const principal = await getUserByApiKey(token);
    expect(principal).toEqual({ kind: "human", userId: alice });

    expect(await getUserByApiKey("kbu_" + "0".repeat(64))).toBeNull();
  });

  it("resolves the x-user-key header through getPrincipalFromRequest", async () => {
    const { token } = await createUserApiKey(alice, "cli");
    const principal = await getPrincipalFromRequest(
      new Request("http://test/api/tasks/1", {
        headers: { "x-user-key": token },
      })
    );
    expect(principal).toEqual({ kind: "human", userId: alice });
  });

  it("scopes list and revoke to the owner", async () => {
    const { key } = await createUserApiKey(alice, "mine");
    await createUserApiKey(bob, "his");

    const aliceKeys = await listUserApiKeys(alice);
    expect(aliceKeys.some((k) => k.id === key.id)).toBe(true);
    expect(aliceKeys.every((k) => !("token" in k) && !("tokenHash" in k))).toBe(true);
    expect((await listUserApiKeys(bob)).some((k) => k.id === key.id)).toBe(false);

    // Bob cannot revoke Alice's key; Alice can.
    expect(await deleteUserApiKey(bob, key.id)).toBe(false);
    expect(await deleteUserApiKey(alice, key.id)).toBe(true);
  });

  it("manages keys with a session, and refuses a key as the credential", async () => {
    // Create via session (the mocked cookie).
    const createRes = await handleCreateUserApiKey(
      new Request("http://test/api/user/api-keys", {
        method: "POST",
        headers: { "content-type": "application/json", "x-test-user": alice },
        body: JSON.stringify({ name: "session-minted" }),
      })
    );
    expect(createRes.status).toBe(201);
    const created = await createRes.json();
    expect(created.token).toMatch(/^kbu_/);

    // A key must not mint, list, or revoke keys — 401 without a session even
    // when a perfectly valid key is presented.
    const viaKey = await handleCreateUserApiKey(
      new Request("http://test/api/user/api-keys", {
        method: "POST",
        headers: { "content-type": "application/json", "x-user-key": created.token },
        body: JSON.stringify({ name: "minted-by-a-key" }),
      })
    );
    expect(viaKey.status).toBe(401);

    const listViaKey = await handleListUserApiKeys(
      new Request("http://test/api/user/api-keys", {
        headers: { "x-user-key": created.token },
      })
    );
    expect(listViaKey.status).toBe(401);

    // Session-scoped delete: bob's session cannot delete alice's key.
    const bobDelete = await handleDeleteUserApiKey(
      new Request("http://test/api/user/api-keys/x", {
        method: "DELETE",
        headers: { "x-test-user": bob },
      }),
      created.id
    );
    expect(bobDelete.status).toBe(404);
  });

  it("opens the human-only notification inbox to a personal key", async () => {
    const { token } = await createUserApiKey(alice, "inbox");
    const viaKey = await handleListNotifications(
      new Request("http://test/api/workspaces/w/notifications", {
        headers: { "x-user-key": token },
      }),
      workspaceId
    );
    expect(viaKey.status).toBe(200);
    // WorkspaceNotifications: { items, unreadCount, lastSeenAt } — the same
    // shape a cookie session gets.
    expect(Array.isArray((await viaKey.json()).items)).toBe(true);

    // The agent-key path stays shut: no session, no user key → 401.
    const anonymous = await handleListNotifications(
      new Request("http://test/api/workspaces/w/notifications"),
      workspaceId
    );
    expect(anonymous.status).toBe(401);
  });
});
