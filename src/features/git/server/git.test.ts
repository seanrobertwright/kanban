import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getBoard } from "@/features/board/server/repository";
import {
  ensurePersonalWorkspace,
  getDefaultBoard,
} from "@/features/workspaces/server/repository";
import { pool, query, queryOne } from "@/shared/db/client";
import { createTask, getTask } from "@/features/tasks/server/repository";
import { createAutomationRule } from "@/features/automations/server/repository";
import { runAutomationsForActivity } from "@/features/automations/server/runner";
import { isEncrypted } from "@/shared/crypto/secret-box";
import {
  connectionForIngress,
  createConnection,
  ingestEvent,
  listConnections,
  listTaskGitLinks,
} from "./repository";
import type { NormalizedGitEvent } from "../types";

/**
 * Git provider connection + link model (2.0): the secret is stored encrypted and
 * shown once; the ingress resolves smart-commit refs to tasks in the connection's
 * workspace (never another's), is idempotent on redelivery, and a git.pr_merged
 * event fires a Phase-1 rule end-to-end.
 */

const createdUsers: string[] = [];
async function createUser(label: string, name: string): Promise<string> {
  const id = `test-${label}-${randomUUID()}`;
  await query(
    `INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, true)`,
    [id, name, `${id}@example.test`]
  );
  createdUsers.push(id);
  return id;
}

function prEvent(
  taskId: number,
  overrides: Partial<NormalizedGitEvent> = {}
): NormalizedGitEvent {
  return {
    provider: "github",
    kind: "pr",
    externalId: "42",
    url: "https://github.com/acme/app/pull/42",
    state: "open",
    title: "Fix the login bug",
    action: "git.pr_opened",
    messages: [`Closes #${taskId}`],
    ...overrides,
  };
}

describe("git connection + ingress (db)", () => {
  let alice: string;
  let workspaceId: string;
  let boardId: number;
  let startCol: number;
  let doneCol: number;

  beforeAll(async () => {
    alice = await createUser("git-alice", "Ada Author");
    await ensurePersonalWorkspace(alice, "GitAlice");
    const board = (await getDefaultBoard(alice))!;
    boardId = board.id;
    workspaceId = board.workspaceId;
    const cols = (await getBoard(alice, boardId))!.columns;
    startCol = cols[0].id;
    doneCol = cols[cols.length - 1].id;
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

  it("stores the signing secret encrypted, shows it once, omits it from reads", async () => {
    const { connection, secret } = await createConnection(alice, workspaceId, {
      provider: "github",
      externalRepo: "acme/app",
    });
    expect(secret.startsWith("ghw_")).toBe(true);

    // The stored column is ciphertext, not the plaintext secret.
    const row = await queryOne<{ secret: string }>(
      `SELECT secret FROM repo_connection WHERE id = $1`,
      [connection.id]
    );
    expect(row!.secret).not.toBe(secret);
    expect(isEncrypted(row!.secret)).toBe(true);

    // The ingress path decrypts back to the original.
    const forIngress = await connectionForIngress(connection.id);
    expect(forIngress!.secret).toBe(secret);

    // The list read never carries the secret.
    const listed = await listConnections(alice, workspaceId);
    expect(listed.some((c) => c.externalRepo === "acme/app")).toBe(true);
    expect(listed[0]).not.toHaveProperty("secret");
  });

  it("links a task referenced by a PR, and is idempotent on redelivery", async () => {
    const { connection } = await createConnection(alice, workspaceId, {
      provider: "github",
      externalRepo: "acme/idem",
    });
    const task = await createTask(alice, { columnId: startCol, title: "Do a thing" });

    const first = await ingestEvent(connection, prEvent(task.id));
    expect(first.linkedTaskIds).toEqual([task.id]);

    const links = await listTaskGitLinks(alice, task.id);
    expect(links).toHaveLength(1);
    expect(links[0].kind).toBe("pr");
    expect(links[0].externalId).toBe("42");
    expect(links[0].state).toBe("open");

    // Redelivering the identical open state changes nothing (no re-log/re-fire).
    const again = await ingestEvent(connection, prEvent(task.id));
    expect(again.linkedTaskIds).toEqual([]);
    expect(await listTaskGitLinks(alice, task.id)).toHaveLength(1);

    // A genuine state change (open → merged) updates the same row and re-links.
    const merged = await ingestEvent(
      connection,
      prEvent(task.id, { state: "merged", action: "git.pr_merged" })
    );
    expect(merged.linkedTaskIds).toEqual([task.id]);
    const after = await listTaskGitLinks(alice, task.id);
    expect(after).toHaveLength(1);
    expect(after[0].state).toBe("merged");
  });

  it("ignores a reference to a task in another workspace (tenancy)", async () => {
    const bob = await createUser("git-bob", "Bob Other");
    await ensurePersonalWorkspace(bob, "GitBob");
    const bobBoard = (await getDefaultBoard(bob))!;
    const bobCols = (await getBoard(bob, bobBoard.id))!.columns;
    const bobTask = await createTask(bob, { columnId: bobCols[0].id, title: "Bob's task" });

    const { connection } = await createConnection(alice, workspaceId, {
      provider: "github",
      externalRepo: "acme/tenancy",
    });
    // Alice's repo names Bob's task id — must not touch it.
    const result = await ingestEvent(connection, prEvent(bobTask.id, { externalId: "99" }));
    expect(result.linkedTaskIds).toEqual([]);
    expect(await listTaskGitLinks(bob, bobTask.id)).toHaveLength(0);
  });

  it("fires a Phase-1 rule when a linked PR merges", async () => {
    const { connection } = await createConnection(alice, workspaceId, {
      provider: "github",
      externalRepo: "acme/automation",
    });
    const task = await createTask(alice, { columnId: startCol, title: "Ship it" });

    await createAutomationRule(alice, boardId, {
      name: "PR merged → Done",
      trigger: { event: "git.pr_merged" },
      actions: [{ type: "move", columnId: doneCol }],
    });

    await ingestEvent(
      connection,
      prEvent(task.id, {
        externalId: "7",
        state: "merged",
        action: "git.pr_merged",
        url: "https://github.com/acme/app/pull/7",
      })
    );

    // after() is a no-op outside a request scope (tests), so drive the runner
    // directly against the git.pr_merged activity the ingress just logged.
    const activity = await queryOne<{ id: string }>(
      `SELECT id FROM activity_log
        WHERE task_id = $1 AND action = 'git.pr_merged'
        ORDER BY id DESC LIMIT 1`,
      [task.id]
    );
    expect(activity).toBeTruthy();
    await runAutomationsForActivity(activity!.id);

    const moved = await getTask(alice, task.id);
    expect(moved!.columnId).toBe(doneCol);
  });
});
