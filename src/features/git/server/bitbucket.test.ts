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
import { handleBitbucketWebhook } from "./handlers";
import {
  normalizeBitbucketEvent,
  verifyBitbucketSignature,
} from "./bitbucket";

/**
 * Bitbucket adapter (2.3): signature verification and payload normalization are
 * pure; the end-to-end test drives a signed pullrequest webhook through the real
 * handler and asserts it links the task it references.
 */

describe("verifyBitbucketSignature", () => {
  const secret = "ghw_test_secret";
  const body = JSON.stringify({ hello: "world" });
  const sign = (s: string, b: string) =>
    `sha256=${createHmac("sha256", s).update(b).digest("hex")}`;

  it("accepts a correct signature", () => {
    expect(verifyBitbucketSignature(secret, body, sign(secret, body))).toBe(true);
  });

  it("rejects a wrong secret, a tampered body, and a missing header", () => {
    expect(verifyBitbucketSignature("other", body, sign(secret, body))).toBe(false);
    expect(verifyBitbucketSignature(secret, body + "x", sign(secret, body))).toBe(false);
    expect(verifyBitbucketSignature(secret, body, null)).toBe(false);
    expect(verifyBitbucketSignature(secret, body, "sha256=deadbeef")).toBe(false);
  });
});

describe("normalizeBitbucketEvent", () => {
  it("maps an opened pull request to git.pr_opened", () => {
    const [e] = normalizeBitbucketEvent("pullrequest:created", {
      pullrequest: {
        id: 42,
        title: "Fix #7",
        description: "closes it",
        state: "OPEN",
        links: { html: { href: "https://bitbucket.org/o/r/pull-requests/42" } },
        source: { branch: { name: "feature/7-fix" } },
      },
    });
    expect(e).toMatchObject({
      provider: "bitbucket",
      kind: "pr",
      externalId: "42",
      state: "open",
      action: "git.pr_opened",
      branch: "feature/7-fix",
    });
    expect(e.messages).toContain("Fix #7");
  });

  it("maps MERGED to git.pr_merged and DECLINED to git.pr_closed", () => {
    const [merged] = normalizeBitbucketEvent("pullrequest:fulfilled", {
      pullrequest: { id: 1, state: "MERGED", links: { html: { href: "u" } } },
    });
    expect(merged).toMatchObject({ state: "merged", action: "git.pr_merged" });

    const [closed] = normalizeBitbucketEvent("pullrequest:rejected", {
      pullrequest: { id: 2, state: "DECLINED", links: { html: { href: "u" } } },
    });
    expect(closed).toMatchObject({ state: "closed", action: "git.pr_closed" });
  });

  it("maps a push to one commit link per commit across changes", () => {
    const events = normalizeBitbucketEvent("repo:push", {
      push: {
        changes: [
          {
            old: { name: "main" },
            new: { type: "branch", name: "main" },
            commits: [
              {
                hash: "abc123",
                message: "Closes #5\n\nbody",
                links: { html: { href: "u1" } },
              },
              { hash: "def456", message: "another", links: { html: { href: "u2" } } },
            ],
          },
        ],
      },
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

  it("emits a branch link for a newly created branch and ignores unmodeled events", () => {
    const events = normalizeBitbucketEvent("repo:push", {
      repository: { links: { html: { href: "https://bitbucket.org/o/r" } } },
      push: {
        changes: [
          {
            old: null,
            new: { type: "branch", name: "feature/9-thing" },
            commits: [],
          },
        ],
      },
    });
    expect(events[0]).toMatchObject({
      kind: "branch",
      externalId: "feature/9-thing",
      action: "git.branch_linked",
      url: "https://bitbucket.org/o/r/branch/feature/9-thing",
    });

    expect(normalizeBitbucketEvent("repo:fork", {})).toEqual([]);
    expect(normalizeBitbucketEvent("issue:created", {})).toEqual([]);
  });
});

describe("bitbucket webhook handler (db)", () => {
  const createdUsers: string[] = [];
  let alice: string;
  let workspaceId: string;
  let startCol: number;

  beforeAll(async () => {
    alice = `test-bb-alice-${randomUUID()}`;
    await query(
      `INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, true)`,
      [alice, "Bea Bucket", `${alice}@example.test`]
    );
    createdUsers.push(alice);
    await ensurePersonalWorkspace(alice, "BbAlice");
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

  function signedRequest(secret: string, eventKey: string, payload: unknown): Request {
    const body = JSON.stringify(payload);
    const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
    return new Request("http://localhost/api/git/webhook/bitbucket/0", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-event-key": eventKey,
        "x-hub-signature": signature,
      },
      body,
    });
  }

  it("links the referenced task from a signed pullrequest webhook", async () => {
    const { connection, secret } = await createConnection(alice, workspaceId, {
      provider: "bitbucket",
      externalRepo: "acme/webhook",
    });
    const task = await createTask(alice, { columnId: startCol, title: "Webhook task" });

    const req = signedRequest(secret, "pullrequest:fulfilled", {
      pullrequest: {
        id: 100,
        title: `Closes #${task.id}`,
        state: "MERGED",
        links: { html: { href: "https://bitbucket.org/acme/webhook/pull-requests/100" } },
        source: { branch: { name: "main" } },
      },
    });
    const res = await handleBitbucketWebhook(req, String(connection.id));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, linked: 1 });

    const links = await listTaskGitLinks(alice, task.id);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      provider: "bitbucket",
      kind: "pr",
      externalId: "100",
      state: "merged",
    });
  });

  it("rejects a bad signature with 401 and an unknown connection with 404", async () => {
    const { connection } = await createConnection(alice, workspaceId, {
      provider: "bitbucket",
      externalRepo: "acme/reject",
    });
    const badSig = new Request("http://localhost/x", {
      method: "POST",
      headers: { "x-event-key": "repo:push", "x-hub-signature": "sha256=bad" },
      body: JSON.stringify({ push: { changes: [] } }),
    });
    expect((await handleBitbucketWebhook(badSig, String(connection.id))).status).toBe(401);
    expect((await handleBitbucketWebhook(badSig, "99999999")).status).toBe(404);
  });
});
