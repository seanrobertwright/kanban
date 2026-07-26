import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  ensurePersonalWorkspace,
  getDefaultBoard,
} from "@/features/workspaces/server/repository";
import { pool, query, queryOne } from "@/shared/db/client";
import { createConnection, listConnections } from "./repository";
import { browseRepoTree, listRepoBranches, type FetchLike } from "./browse";
import {
  normalizeBitbucketBranches,
  normalizeBitbucketTree,
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

  it("folds Bitbucket src listings ({values}, commit_directory|commit_file, path-derived names)", () => {
    const entries = normalizeBitbucketTree({
      values: [
        { path: "src/app.ts", type: "commit_file", size: 42 },
        { path: "src/lib", type: "commit_directory" },
      ],
    });
    expect(entries.map((e) => `${e.name}:${e.type}`)).toEqual(["lib:dir", "app.ts:file"]);
    expect(entries[1].size).toBe(42);
    expect(entries[1].path).toBe("src/app.ts");
    expect(normalizeBitbucketTree(null)).toEqual([]);
  });

  it("folds Bitbucket branch lists ({values})", () => {
    expect(
      normalizeBitbucketBranches({ values: [{ name: "main" }, { bogus: 1 }] })
    ).toEqual([{ name: "main", protected: false }]);
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

  it("neutralizes path traversal so a caller cannot escape the connection's repo", async () => {
    let captured = "";
    const capturing: FetchLike = async (url) => {
      captured = url;
      return { ok: true, status: 200, json: async () => [] };
    };
    // A malicious path that would `..`-normalize to a different repo without encoding.
    await browseRepoTree(
      alice,
      connectionId,
      { path: "../../evil-owner/evil-repo/contents" },
      { fetchImpl: capturing }
    );
    // Still scoped to acme/app's contents — the traversal segments survive only as
    // harmless subpath names under it, never as a different repo owner/name.
    expect(captured.startsWith("https://api.github.com/repos/acme/app/contents/")).toBe(true);
    expect(captured).not.toContain("/repos/evil-owner");
    // Traversal stripped — no raw ".." reaches the URL to be normalized away.
    expect(captured).not.toMatch(/\.\.(\/|$)/);
  });

  it("surfaces a provider error as a thrown AuthzError", async () => {
    await expect(
      browseRepoTree(alice, connectionId, {}, { fetchImpl: stub(null, false, 404) })
    ).rejects.toThrow(/404/);
  });

  it("bears the GitHub PAT as a bearer token", async () => {
    await createConnection(alice, workspaceId, {
      provider: "github",
      externalRepo: "acme/app",
      accessToken: "ghp_test_pat",
    });
    let headers: Record<string, string> = {};
    const capturing: FetchLike = async (_url, init) => {
      headers = init?.headers ?? {};
      return { ok: true, status: 200, json: async () => [] };
    };
    await browseRepoTree(alice, connectionId, {}, { fetchImpl: capturing });
    expect(headers.authorization).toBe("Bearer ghp_test_pat");
  });

  it("bears the GitLab token in PRIVATE-TOKEN", async () => {
    const conn = await createConnection(alice, workspaceId, {
      provider: "gitlab",
      externalRepo: "acme/glapp",
      accessToken: "glpat-test",
    });
    let headers: Record<string, string> = {};
    let captured = "";
    const capturing: FetchLike = async (url, init) => {
      captured = url;
      headers = init?.headers ?? {};
      return { ok: true, status: 200, json: async () => [] };
    };
    await listRepoBranches(alice, conn.connection.id, { fetchImpl: capturing });
    expect(headers["private-token"]).toBe("glpat-test");
    expect(headers.authorization).toBeUndefined();
    expect(captured).toContain("gitlab.com/api/v4/projects/acme%2Fglapp/repository/branches");
  });

  it("browses Bitbucket over the 2.0 src API with basic app-password auth", async () => {
    const conn = await createConnection(alice, workspaceId, {
      provider: "bitbucket",
      externalRepo: "acme/bbapp",
      accessToken: "user:app-password",
    });
    let headers: Record<string, string> = {};
    let captured = "";
    const capturing: FetchLike = async (url, init) => {
      captured = url;
      headers = init?.headers ?? {};
      return {
        ok: true,
        status: 200,
        json: async () => ({
          values: [{ path: "readme.md", type: "commit_file", size: 3 }],
        }),
      };
    };
    const entries = await browseRepoTree(
      alice,
      conn.connection.id,
      { path: "docs", ref: "main" },
      { fetchImpl: capturing }
    );
    expect(entries).toEqual([{ name: "readme.md", path: "readme.md", type: "file", size: 3 }]);
    expect(captured).toBe(
      "https://api.bitbucket.org/2.0/repositories/acme/bbapp/src/main/docs?pagelen=100"
    );
    expect(headers.authorization).toBe(
      `Basic ${Buffer.from("user:app-password").toString("base64")}`
    );

    // Branch listing rides refs/branches and folds the {values} envelope.
    const branchFetch: FetchLike = async (url) => {
      captured = url;
      return { ok: true, status: 200, json: async () => ({ values: [{ name: "main" }] }) };
    };
    const branches = await listRepoBranches(alice, conn.connection.id, {
      fetchImpl: branchFetch,
    });
    expect(branches).toEqual([{ name: "main", protected: false }]);
    expect(captured).toBe(
      "https://api.bitbucket.org/2.0/repositories/acme/bbapp/refs/branches?pagelen=100"
    );
  });

  it("stores the access token encrypted and never returns it from reads", async () => {
    const row = await queryOne<{ accessToken: string | null }>(
      `SELECT access_token AS "accessToken" FROM repo_connection
        WHERE workspace_id = $1 AND provider = 'github' AND external_repo = 'acme/app'`,
      [workspaceId]
    );
    expect(row?.accessToken).toBeTruthy();
    expect(row?.accessToken?.startsWith("v1.")).toBe(true);
    expect(row?.accessToken).not.toContain("ghp_test_pat");

    const listed = await listConnections(alice, workspaceId);
    for (const conn of listed) {
      expect(JSON.stringify(conn)).not.toContain("ghp_test_pat");
      expect(conn).not.toHaveProperty("accessToken");
      expect(conn).not.toHaveProperty("secret");
    }

    // A rotate without a token keeps the stored one (COALESCE).
    await createConnection(alice, workspaceId, {
      provider: "github",
      externalRepo: "acme/app",
    });
    let headers: Record<string, string> = {};
    const capturing: FetchLike = async (_url, init) => {
      headers = init?.headers ?? {};
      return { ok: true, status: 200, json: async () => [] };
    };
    await browseRepoTree(alice, connectionId, {}, { fetchImpl: capturing });
    expect(headers.authorization).toBe("Bearer ghp_test_pat");
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
