import { createHmac, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getBoard } from "@/features/board/server/repository";
import {
  ensurePersonalWorkspace,
  getDefaultBoard,
} from "@/features/workspaces/server/repository";
import { pool, query } from "@/shared/db/client";
import { createTask } from "@/features/tasks/server/repository";
import { createConnection, listTaskGitLinks } from "./repository";
import { handleGithubWebhook } from "./handlers";
import { normalizeGithubEvent, verifyGithubSignature } from "./github";

/**
 * GitHub App adapter (2.1): signature verification and payload normalization are
 * pure; the end-to-end test drives a signed pull_request webhook through the real
 * handler and asserts it links the task it references.
 */

describe("verifyGithubSignature", () => {
  const secret = "ghw_test_secret";
  const body = JSON.stringify({ hello: "world" });
  const sign = (s: string, b: string) =>
    `sha256=${createHmac("sha256", s).update(b).digest("hex")}`;

  it("accepts a correct signature", () => {
    expect(verifyGithubSignature(secret, body, sign(secret, body))).toBe(true);
  });

  it("rejects a wrong secret, a tampered body, and a missing header", () => {
    expect(verifyGithubSignature("other", body, sign(secret, body))).toBe(false);
    expect(verifyGithubSignature(secret, body + "x", sign(secret, body))).toBe(false);
    expect(verifyGithubSignature(secret, body, null)).toBe(false);
    expect(verifyGithubSignature(secret, body, "sha256=deadbeef")).toBe(false);
  });
});

describe("normalizeGithubEvent", () => {
  it("maps an opened PR to git.pr_opened", () => {
    const [e] = normalizeGithubEvent("pull_request", {
      action: "opened",
      pull_request: {
        number: 42,
        html_url: "https://github.com/o/r/pull/42",
        title: "Fix #7",
        state: "open",
        head: { ref: "feature/7-fix" },
      },
    });
    expect(e).toMatchObject({
      kind: "pr",
      externalId: "42",
      state: "open",
      action: "git.pr_opened",
      branch: "feature/7-fix",
    });
    expect(e.messages).toContain("Fix #7");
  });

  it("maps a merged PR to git.pr_merged and a closed one to git.pr_closed", () => {
    const [merged] = normalizeGithubEvent("pull_request", {
      action: "closed",
      pull_request: { number: 1, html_url: "u", state: "closed", merged: true },
    });
    expect(merged).toMatchObject({ state: "merged", action: "git.pr_merged" });

    const [closed] = normalizeGithubEvent("pull_request", {
      action: "closed",
      pull_request: { number: 2, html_url: "u", state: "closed", merged: false },
    });
    expect(closed).toMatchObject({ state: "closed", action: "git.pr_closed" });
  });

  it("maps a push to one commit link per commit", () => {
    const events = normalizeGithubEvent("push", {
      ref: "refs/heads/main",
      commits: [
        { id: "abc123", url: "u1", message: "Closes #5\n\nbody" },
        { id: "def456", url: "u2", message: "another" },
      ],
    });
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      kind: "commit",
      externalId: "abc123",
      action: "git.commit_linked",
      branch: "main",
      title: "Closes #5",
    });
  });

  it("maps a branch create and ignores unmodeled events", () => {
    const [branch] = normalizeGithubEvent("create", {
      ref: "feature/9-thing",
      ref_type: "branch",
      repository: { full_name: "o/r" },
    });
    expect(branch).toMatchObject({ kind: "branch", action: "git.branch_linked" });
    expect(normalizeGithubEvent("issues", { action: "opened" })).toEqual([]);
    expect(normalizeGithubEvent("create", { ref_type: "tag", ref: "v1" })).toEqual([]);
  });
});

describe("github webhook handler (db)", () => {
  const createdUsers: string[] = [];
  let alice: string;
  let workspaceId: string;
  let startCol: number;

  beforeAll(async () => {
    alice = `test-gh-alice-${randomUUID()}`;
    await query(
      `INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, true)`,
      [alice, "Gina Hub", `${alice}@example.test`]
    );
    createdUsers.push(alice);
    await ensurePersonalWorkspace(alice, "GhAlice");
    const board = (await getDefaultBoard(alice))!;
    workspaceId = board.workspaceId;
    startCol = (await getBoard(alice, board.id))!.columns[0].id;
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

  function signedRequest(secret: string, event: string, payload: unknown): Request {
    const body = JSON.stringify(payload);
    const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
    return new Request("http://localhost/api/git/webhook/github/0", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-github-event": event,
        "x-hub-signature-256": signature,
      },
      body,
    });
  }

  it("links the referenced task from a signed pull_request webhook", async () => {
    const { connection, secret } = await createConnection(alice, workspaceId, {
      provider: "github",
      externalRepo: "acme/webhook",
    });
    const task = await createTask(alice, { columnId: startCol, title: "Webhook task" });

    const req = signedRequest(secret, "pull_request", {
      action: "closed",
      pull_request: {
        number: 100,
        html_url: "https://github.com/acme/webhook/pull/100",
        title: `Closes #${task.id}`,
        state: "closed",
        merged: true,
        head: { ref: "main" },
      },
    });
    const res = await handleGithubWebhook(req, String(connection.id));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, linked: 1 });

    const links = await listTaskGitLinks(alice, task.id);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ kind: "pr", externalId: "100", state: "merged" });
  });

  it("rejects a bad signature with 401 and an unknown connection with 404", async () => {
    const { connection } = await createConnection(alice, workspaceId, {
      provider: "github",
      externalRepo: "acme/reject",
    });
    const badSig = new Request("http://localhost/x", {
      method: "POST",
      headers: { "x-github-event": "push", "x-hub-signature-256": "sha256=bad" },
      body: JSON.stringify({ ref: "refs/heads/main", commits: [] }),
    });
    expect((await handleGithubWebhook(badSig, String(connection.id))).status).toBe(401);
    expect((await handleGithubWebhook(badSig, "99999999")).status).toBe(404);
  });
});
