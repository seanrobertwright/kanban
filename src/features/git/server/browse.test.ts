import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  ensurePersonalWorkspace,
  getDefaultBoard,
} from "@/features/workspaces/server/repository";
import { pool, query } from "@/shared/db/client";
import { createConnection } from "./repository";
import { browseRepoTree, listRepoBranches, type FetchLike } from "./browse";
import {
  normalizeGithubTree,
  normalizeGitlabTree,
  normalizeGithubBranches,
} from "../lib/browse";

/**
 * Repository browsing (2.10): the normalizers fold each provider's shape onto the
 * common one (pure); the proxy gates on workspace membership and passes the
 * provider response through an injected fetch — no network.
 */

describe("normalize repo tree (pure)", () => {
  it("folds GitHub contents (dirs before files) and a single-file response", () => {
    const entries = normalizeGithubTree([
      { name: "readme.md", path: "readme.md", type: "file", size: 12 },
      { name: "src", path: "src", type: "dir" },
    ]);
    expect(entries.map((e) => e.name)).toEqual(["src", "readme.md"]);
    expect(entries[0]).toMatchObject({ type: "dir", size: null });
    expect(entries[1]).toMatchObject({ type: "file", size: 12 });

    const one = normalizeGithubTree({ name: "a.ts", path: "src/a.ts", type: "file", size: 3 });
    expect(one).toHaveLength(1);
    expect(one[0]).toMatchObject({ path: "src/a.ts", type: "file" });
  });

  it("folds GitLab tree (tree→dir, blob→file)", () => {
    const entries = normalizeGitlabTree([
      { name: "app", path: "app", type: "tree" },
      { name: "go.mod", path: "go.mod", type: "blob" },
    ]);
    expect(entries.map((e) => `${e.name}:${e.type}`)).toEqual(["app:dir", "go.mod:file"]);
  });

  it("folds branch lists", () => {
    expect(
      normalizeGithubBranches([
        { name: "main", protected: true },
        { name: "dev" },
        { bogus: true },
      ])
    ).toEqual([
      { name: "main", protected: true },
      { name: "dev", protected: false },
    ]);
  });
});

describe("repo browse proxy (db)", () => {
  const createdUsers: string[] = [];
  let alice: string;
  let workspaceId: string;
  let connectionId: number;

  const stub = (payload: unknown, ok = true, status = 200): FetchLike =>
    async () => ({ ok, status, json: async () => payload });

  beforeAll(async () => {
    alice = `test-browse-alice-${randomUUID()}`;
    await query(
      `INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, true)`,
      [alice, "Bree Browse", `${alice}@example.test`]
    );
    createdUsers.push(alice);
    await ensurePersonalWorkspace(alice, "BrowseAlice");
    const board = (await getDefaultBoard(alice))!;
    workspaceId = board.workspaceId;
    connectionId = (
      await createConnection(alice, workspaceId, { provider: "github", externalRepo: "acme/app" })
    ).connection.id;
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

  it("returns a normalized tree through the injected fetch", async () => {
    const entries = await browseRepoTree(
      alice,
      connectionId,
      { path: "src" },
      { fetchImpl: stub([{ name: "a.ts", path: "src/a.ts", type: "file", size: 9 }]) }
    );
    expect(entries).toEqual([{ name: "a.ts", path: "src/a.ts", type: "file", size: 9 }]);
  });

  it("returns normalized branches", async () => {
    const branches = await listRepoBranches(alice, connectionId, {
      fetchImpl: stub([{ name: "main", protected: true }]),
    });
    expect(branches).toEqual([{ name: "main", protected: true }]);
  });

  it("surfaces a provider error as a thrown AuthzError", async () => {
    await expect(
      browseRepoTree(alice, connectionId, {}, { fetchImpl: stub(null, false, 404) })
    ).rejects.toThrow(/404/);
  });

  it("refuses a non-member and an unknown connection", async () => {
    const bob = `test-browse-bob-${randomUUID()}`;
    await query(
      `INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, true)`,
      [bob, "Bob Outsider", `${bob}@example.test`]
    );
    createdUsers.push(bob);
    await ensurePersonalWorkspace(bob, "BrowseBob");

    await expect(
      browseRepoTree(bob, connectionId, {}, { fetchImpl: stub([]) })
    ).rejects.toThrow();
    await expect(
      browseRepoTree(alice, 99999999, {}, { fetchImpl: stub([]) })
    ).rejects.toThrow(/not found/i);
  });
});
