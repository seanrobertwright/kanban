import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getBoard } from "@/features/board/server/repository";
import {
  ensurePersonalWorkspace,
  getDefaultBoard,
} from "@/features/workspaces/server/repository";
import { pool, query } from "@/shared/db/client";
import { createTask, moveTask } from "@/features/tasks/server/repository";
import { createAutomationRule } from "./repository";
import { runAutomationsForActivity } from "./runner";

/**
 * Notification rules (rock 1.5): a notify action pings the task's assignee by
 * posting a comment that @-mentions them — the bell (016/024) then surfaces it.
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

describe("notify action (db)", () => {
  let alice: string;
  let boardId: number;
  let col1: number;
  let col2: number;

  beforeAll(async () => {
    alice = await createUser("notify-alice", "Alice Ackerman");
    await ensurePersonalWorkspace(alice, "NotifyAlice");
    boardId = (await getDefaultBoard(alice))!.id;
    const cols = (await getBoard(alice, boardId))!.columns;
    [col1, col2] = [cols[0].id, cols[1].id];
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

  it("notifies the assignee with a mentioning comment", async () => {
    const task = await createTask(alice, {
      columnId: col1,
      title: "ping on move",
      assignee: { type: "human", id: alice },
    });
    await createAutomationRule(alice, boardId, {
      name: "Notify assignee on move",
      trigger: { event: "task.moved" },
      actions: [{ type: "notify", target: "assignee", message: "your task moved" }],
    });

    await moveTask(alice, task.id, { columnId: col2, position: 0 });
    const activityId = await query<{ id: string }>(
      `SELECT id FROM activity_log WHERE task_id = $1 AND action = 'task.moved'
        ORDER BY id DESC LIMIT 1`,
      [task.id]
    ).then((r) => r[0].id);
    await runAutomationsForActivity(activityId);

    // A comment mentioning Alice was posted on the task.
    const mentions = await query<{ n: string }>(
      `SELECT count(*) AS n
         FROM comment c JOIN comment_mention m ON m.comment_id = c.id
        WHERE c.task_id = $1 AND m.user_id = $2`,
      [task.id, alice]
    );
    expect(Number(mentions[0].n)).toBeGreaterThanOrEqual(1);
  });
});
