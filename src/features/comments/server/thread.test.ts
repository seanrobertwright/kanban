import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { listWorkspaceNotifications } from "@/features/activity/server/repository";
import { getBoard } from "@/features/board/server/repository";
import { createTask } from "@/features/tasks/server/repository";
import {
  ensurePersonalWorkspace,
  getDefaultBoard,
} from "@/features/workspaces/server/repository";
import { pool, query } from "@/shared/db/client";
import {
  createComment,
  listCommentsForTask,
  resolveComment,
  updateComment,
} from "./repository";

/**
 * Against a real Postgres because both features are SQL facts: a mention is a
 * server-side parse against member names written in the comment's transaction,
 * and the bell's "mentioned you" is an EXISTS the notification read computes
 * per reader.
 */

const createdUsers: string[] = [];

async function createUser(label: string, name: string): Promise<string> {
  const id = `test-${label}-${randomUUID()}`;
  await query(
    `INSERT INTO "user" (id, name, email, "emailVerified")
     VALUES ($1, $2, $3, true)`,
    [id, name, `${id}@example.test`]
  );
  createdUsers.push(id);
  return id;
}

describe("comment mentions and resolution", () => {
  let alice: string;
  let bob: string;
  let ws: string;
  let taskId: number;

  beforeAll(async () => {
    alice = await createUser("th-alice", "Thread Alice");
    bob = await createUser("th-bob", "Thread Bob");
    const workspace = await ensurePersonalWorkspace(alice, "ThreadAlice");
    ws = workspace.id;
    await query(
      `INSERT INTO workspace_member (workspace_id, user_id, role)
       VALUES ($1, $2, 'member')`,
      [ws, bob]
    );
    const boardId = (await getDefaultBoard(alice))!.id;
    const columnId = (await getBoard(alice, boardId))!.columns[0].id;
    taskId = (await createTask(alice, { columnId, title: "Thread task" })).id;
  });

  afterAll(async () => {
    await query(`DELETE FROM workspace WHERE id = $1`, [ws]);
    await query(`DELETE FROM "user" WHERE id = ANY($1)`, [createdUsers]);
    await pool.end();
  });

  it("parses @Name mentions into rows, and the bell says 'mentioned you'", async () => {
    const comment = await createComment(alice, {
      taskId,
      body: "Hey @Thread Bob, can you look at this?",
    });

    const { rows } = await pool.query(
      `SELECT user_id FROM comment_mention WHERE comment_id = $1`,
      [comment.id]
    );
    expect(rows.map((r) => r.user_id)).toEqual([bob]);

    // Bob's bell flags the row; Alice's (the author, but also unmentioned)
    // would not — and her own action is excluded from her feed anyway.
    const bobFeed = await listWorkspaceNotifications(bob, ws);
    const entry = bobFeed.items.find((i) => i.action === "comment.created")!;
    expect(entry.mentionedMe).toBe(true);
  });

  it("recomputes mentions on edit — removing the @ removes the row", async () => {
    const comment = await createComment(alice, {
      taskId,
      body: "@Thread Bob ping",
    });
    await updateComment(alice, comment.id, { body: "never mind" });

    const { rows } = await pool.query(
      `SELECT 1 FROM comment_mention WHERE comment_id = $1`,
      [comment.id]
    );
    expect(rows).toHaveLength(0);
  });

  it("does not mention on a partial or wrong name", async () => {
    const comment = await createComment(alice, {
      taskId,
      body: "@Thread nobody and @ThreadBob are not names here",
    });
    const { rows } = await pool.query(
      `SELECT 1 FROM comment_mention WHERE comment_id = $1`,
      [comment.id]
    );
    expect(rows).toHaveLength(0);
  });

  it("resolves and reopens, member-gated, logging both", async () => {
    const comment = await createComment(bob, { taskId, body: "Is this done?" });

    const resolved = await resolveComment(alice, comment.id, true);
    expect(resolved.resolvedAt).not.toBeNull();
    expect(resolved.resolvedBy).toBe(alice);

    // The flags ride the list read.
    const listed = await listCommentsForTask(alice, taskId);
    const entry = listed.find((c) => c.id === comment.id)!;
    expect(entry.resolvedAt).not.toBeNull();
    expect(entry.canResolve).toBe(true);

    const reopened = await resolveComment(bob, comment.id, false);
    expect(reopened.resolvedAt).toBeNull();
    expect(reopened.resolvedBy).toBeNull();

    const { rows } = await pool.query(
      `SELECT action FROM activity_log
        WHERE task_id = $1 AND action LIKE 'comment.re%' ORDER BY id`,
      [taskId]
    );
    expect(rows.map((r) => r.action)).toEqual([
      "comment.resolved",
      "comment.reopened",
    ]);
  });

  it("a no-op resolve writes nothing", async () => {
    const comment = await createComment(alice, { taskId, body: "quiet one" });
    await resolveComment(alice, comment.id, false);
    const { rows } = await pool.query(
      `SELECT 1 FROM activity_log
        WHERE task_id = $1 AND action = 'comment.reopened'
          AND (before->>'commentId')::int = $2`,
      [taskId, comment.id]
    );
    expect(rows).toHaveLength(0);
  });
});
