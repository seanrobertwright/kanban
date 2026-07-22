import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getBoard } from "@/features/board/server/repository";
import {
  ensurePersonalWorkspace,
  getDefaultBoard,
} from "@/features/workspaces/server/repository";
import { pool, query } from "@/shared/db/client";
import { createTask } from "@/features/tasks/server/repository";
import { createConnection, listTaskGitLinks } from "./repository";
import { handleGitlabWebhook } from "./handlers";
import { normalizeGitlabEvent, verifyGitlabToken } from "./gitlab";

/**
 * GitLab adapter (2.2): token verification and payload normalization are pure; the
 * end-to-end test drives a token-authed merge_request webhook through the real
 * handler and asserts it links the task it references.
 */

describe("verifyGitlabToken", () => {
  const secret = "ghw_test_secret";

  it("accepts the exact token", () => {
    expect(verifyGitlabToken(secret, secret)).toBe(true);
  });

  it("rejects a wrong token, a wrong length, and a missing header", () => {
    expect(verifyGitlabToken(secret, "other_secret_value")).toBe(false);
    expect(verifyGitlabToken(secret, secret + "x")).toBe(false);
    expect(verifyGitlabToken(secret, null)).toBe(false);
    expect(verifyGitlabToken(secret, "")).toBe(false);
  });
});

describe("normalizeGitlabEvent", () => {
  it("maps an opened merge_request to git.pr_opened", () => {
    const [e] = normalizeGitlabEvent({
      object_kind: "merge_request",
      object_attributes: {
        iid: 42,
        url: "https://gitlab.com/o/r/-/merge_requests/42",
        title: "Fix #7",
        description: "closes it",
        state: "opened",
        source_branch: "feature/7-fix",
      },
    });
    expect(e).toMatchObject({
      provider: "gitlab",
      kind: "pr",
      externalId: "42",
      state: "open",
      action: "git.pr_opened",
      branch: "feature/7-fix",
    });
    expect(e.messages).toContain("Fix #7");
  });

  it("maps a merged MR to git.pr_merged and a closed one to git.pr_closed", () => {
    const [merged] = normalizeGitlabEvent({
      object_kind: "merge_request",
      object_attributes: { iid: 1, url: "u", state: "merged" },
    });
    expect(merged).toMatchObject({ state: "merged", action: "git.pr_merged" });

    const [closed] = normalizeGitlabEvent({
      object_kind: "merge_request",
      object_attributes: { iid: 2, url: "u", state: "closed" },
    });
    expect(closed).toMatchObject({ state: "closed", action: "git.pr_closed" });
  });

  it("maps a push to one commit link per commit", () => {
    const events = normalizeGitlabEvent({
      object_kind: "push",
      ref: "refs/heads/main",
      before: "abc0000000000000000000000000000000000001",
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

  it("emits a branch link on a new-branch push and ignores unmodeled events", () => {
    const events = normalizeGitlabEvent({
      object_kind: "push",
      ref: "refs/heads/feature/9-thing",
      before: "0000000000000000000000000000000000000000",
      project: { web_url: "https://gitlab.com/o/r" },
      commits: [{ id: "sha1", url: "u", message: "start" }],
    });
    expect(events[0]).toMatchObject({
      kind: "branch",
      externalId: "feature/9-thing",
      action: "git.branch_linked",
      url: "https://gitlab.com/o/r/-/tree/feature/9-thing",
    });
    expect(events[1]).toMatchObject({ kind: "commit", externalId: "sha1" });

    expect(normalizeGitlabEvent({ object_kind: "pipeline" })).toEqual([]);
    expect(normalizeGitlabEvent({ object_kind: "note" })).toEqual([]);
  });
});

describe("gitlab webhook handler (db)", () => {
  const createdUsers: string[] = [];
  let alice: string;
  let workspaceId: string;
  let startCol: number;

  beforeAll(async () => {
    alice = `test-gl-alice-${randomUUID()}`;
    await query(
      `INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, true)`,
      [alice, "Gina Lab", `${alice}@example.test`]
    );
    createdUsers.push(alice);
    await ensurePersonalWorkspace(alice, "GlAlice");
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

  function tokenRequest(token: string, payload: unknown): Request {
    return new Request("http://localhost/api/git/webhook/gitlab/0", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-gitlab-token": token,
      },
      body: JSON.stringify(payload),
    });
  }

  it("links the referenced task from a token-authed merge_request webhook", async () => {
    const { connection, secret } = await createConnection(alice, workspaceId, {
      provider: "gitlab",
      externalRepo: "acme/webhook",
    });
    const task = await createTask(alice, { columnId: startCol, title: "Webhook task" });

    const req = tokenRequest(secret, {
      object_kind: "merge_request",
      object_attributes: {
        iid: 100,
        url: "https://gitlab.com/acme/webhook/-/merge_requests/100",
        title: `Closes #${task.id}`,
        state: "merged",
        source_branch: "main",
      },
    });
    const res = await handleGitlabWebhook(req, String(connection.id));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, linked: 1 });

    const links = await listTaskGitLinks(alice, task.id);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      provider: "gitlab",
      kind: "pr",
      externalId: "100",
      state: "merged",
    });
  });

  it("rejects a bad token with 401 and an unknown connection with 404", async () => {
    const { connection } = await createConnection(alice, workspaceId, {
      provider: "gitlab",
      externalRepo: "acme/reject",
    });
    const badToken = new Request("http://localhost/x", {
      method: "POST",
      headers: { "x-gitlab-token": "wrong" },
      body: JSON.stringify({ object_kind: "push", commits: [] }),
    });
    expect((await handleGitlabWebhook(badToken, String(connection.id))).status).toBe(401);
    expect((await handleGitlabWebhook(badToken, "99999999")).status).toBe(404);
  });

  it("refuses a GitLab token presented to a GitHub connection (provider check)", async () => {
    const { connection, secret } = await createConnection(alice, workspaceId, {
      provider: "github",
      externalRepo: "acme/gh-only",
    });
    const req = tokenRequest(secret, { object_kind: "push", commits: [] });
    // The connection exists and the token is correct, but it is a GitHub
    // connection — the GitLab ingress must 404, not process it.
    expect((await handleGitlabWebhook(req, String(connection.id))).status).toBe(404);
  });
});
