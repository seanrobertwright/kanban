import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getBoard } from "@/features/board/server/repository";
import { createTask } from "@/features/tasks/server/repository";
import {
  ensurePersonalWorkspace,
  getDefaultBoard,
} from "@/features/workspaces/server/repository";
import { pool, query } from "@/shared/db/client";
import { AuthzError } from "@/features/workspaces/server/authz";
import { createComment, deleteComment, listCommentsForTask } from "./repository";

/**
 * Against a real Postgres because threading is a database fact: parent_id carries
 * an ON DELETE CASCADE (deleting a remark takes its replies), and the depth-1
 * rule is a repository check reading an immutable parent_id — exactly the kind of
 * thing a mock would agree with while proving nothing (033).
 */

const createdUsers: string[] = [];

async function createUser(label: string): Promise<string> {
  const id = `test-${label}-${randomUUID()}`;
  await query(
    `INSERT INTO "user" (id, name, email, "emailVerified")
     VALUES ($1, $2, $3, true)`,
    [id, `Test ${label}`, `${id}@example.test`]
  );
  createdUsers.push(id);
  return id;
}

describe("threaded replies", () => {
  let alice: string;
  let taskId: number;
  let otherTaskId: number;

  beforeAll(async () => {
    alice = await createUser("reply-alice");
    await ensurePersonalWorkspace(alice, "ReplyAlice");
    const boardId = (await getDefaultBoard(alice))!.id;
    const columnId = (await getBoard(alice, boardId))!.columns[0].id;
    taskId = (await createTask(alice, { columnId, title: "Discuss me" })).id;
    otherTaskId = (await createTask(alice, { columnId, title: "Elsewhere" })).id;
  });

  afterAll(async () => {
    await query(
      `DELETE FROM workspace w
        WHERE EXISTS (SELECT 1 FROM workspace_member m
                       WHERE m.workspace_id = w.id AND m.user_id = ANY($1))`,
      [createdUsers]
    );
    await query(`DELETE FROM "user" WHERE id = ANY($1)`, [createdUsers]);
    await pool.end();
  });

  it("posts a reply under a top-level comment", async () => {
    const parent = await createComment(alice, { taskId, body: "Top-level" });
    expect(parent.parentId).toBeNull();

    const reply = await createComment(alice, {
      taskId,
      body: "A reply",
      parentId: parent.id,
    });
    expect(reply.parentId).toBe(parent.id);
  });

  it("refuses a reply to a reply — depth is 1", async () => {
    const parent = await createComment(alice, { taskId, body: "Root" });
    const reply = await createComment(alice, {
      taskId,
      body: "Child",
      parentId: parent.id,
    });

    await expect(
      createComment(alice, {
        taskId,
        body: "Grandchild",
        parentId: reply.id,
      })
    ).rejects.toMatchObject({ kind: "conflict" } satisfies Partial<AuthzError>);
  });

  it("refuses a reply whose parent is on another task (not_found, anti-oracle)", async () => {
    const elsewhere = await createComment(alice, {
      taskId: otherTaskId,
      body: "Other thread",
    });
    await expect(
      createComment(alice, {
        taskId,
        body: "Wrong task",
        parentId: elsewhere.id,
      })
    ).rejects.toMatchObject({ kind: "not_found" } satisfies Partial<AuthzError>);
  });

  it("deleting a parent cascades to its replies", async () => {
    const parent = await createComment(alice, { taskId, body: "Doomed" });
    await createComment(alice, {
      taskId,
      body: "Goes with it",
      parentId: parent.id,
    });

    await deleteComment(alice, parent.id);

    // Neither the parent nor the reply survives — the CASCADE took the reply,
    // and the child is gone from the thread with its parent.
    const remaining = await listCommentsForTask(alice, taskId);
    expect(remaining.some((c) => c.id === parent.id)).toBe(false);
    expect(remaining.some((c) => c.parentId === parent.id)).toBe(false);
  });
});
