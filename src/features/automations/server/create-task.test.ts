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
 * create_task action (rock 1.10, the "declare incident" primitive): a rule can
 * spawn a new task, defaulting to the triggering task's column.
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

describe("create_task action (db)", () => {
  let alice: string;
  let boardId: number;
  let col1: number;
  let col2: number;

  beforeAll(async () => {
    alice = await createUser("mktask-alice");
    await ensurePersonalWorkspace(alice, "MkTaskAlice");
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

  it("spawns a task into a named column when its rule fires", async () => {
    const seed = await createTask(alice, { columnId: col1, title: "trigger" });
    await createAutomationRule(alice, boardId, {
      name: "Declare incident on move",
      trigger: { event: "task.moved" },
      actions: [{ type: "create_task", title: "INCIDENT: investigate", columnId: col2 }],
    });

    const before = (
      await query<{ n: string }>(`SELECT count(*) AS n FROM task WHERE column_id = $1`, [col2])
    )[0].n;

    await moveTask(alice, seed.id, { columnId: col2, position: 0 });
    const activityId = await query<{ id: string }>(
      `SELECT id FROM activity_log WHERE task_id = $1 AND action = 'task.moved'
        ORDER BY id DESC LIMIT 1`,
      [seed.id]
    ).then((r) => r[0].id);
    await runAutomationsForActivity(activityId);

    const after = (
      await query<{ n: string }>(`SELECT count(*) AS n FROM task WHERE column_id = $1`, [col2])
    )[0].n;
    // seed moved in (+1) and the incident task was created (+1).
    expect(Number(after)).toBe(Number(before) + 2);

    const incident = await query<{ title: string }>(
      `SELECT title FROM task WHERE column_id = $1 AND title = 'INCIDENT: investigate'`,
      [col2]
    );
    expect(incident.length).toBe(1);
  });
});
