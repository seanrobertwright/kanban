import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getBoard } from "@/features/board/server/repository";
import {
  ensurePersonalWorkspace,
  getDefaultBoard,
} from "@/features/workspaces/server/repository";
import { pool, query, queryOne } from "@/shared/db/client";
import { createTask, updateTask } from "./repository";

/**
 * Against a real Postgres because the score is computed in SQL (taskColumns'
 * derivation) and the 0–10 CHECK is a database rule — a mock would agree with a
 * formula it never runs. The three-input semantics (value, estimate, risk) and
 * the value-per-effort maths are the load-bearing claims (034).
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

describe("prioritisation scoring", () => {
  let alice: string;
  let columnId: number;

  beforeAll(async () => {
    alice = await createUser("score-alice");
    await ensurePersonalWorkspace(alice, "ScoreAlice");
    const boardId = (await getDefaultBoard(alice))!.id;
    columnId = (await getBoard(alice, boardId))!.columns[0].id;
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

  it("computes value per effort — risk zero leaves it untouched", async () => {
    const task = await createTask(alice, {
      columnId,
      title: "Cheap and valuable",
      value: 8,
      estimate: 2,
      risk: 0,
    });
    expect(task.value).toBe(8);
    expect(task.risk).toBe(0);
    // 8 / (2 × (1 + 0/10)) = 4.
    expect(task.priorityScore).toBe(4);
  });

  it("discounts the score by risk", async () => {
    const task = await createTask(alice, {
      columnId,
      title: "Risky",
      value: 8,
      estimate: 2,
      risk: 5,
    });
    // 8 / (2 × 1.5) = 2.666… → 2.67 at two places.
    expect(task.priorityScore).toBe(2.67);
  });

  it("is null until both value and a non-zero estimate exist", async () => {
    const noEstimate = await createTask(alice, {
      columnId,
      title: "Valued, unestimated",
      value: 9,
    });
    expect(noEstimate.priorityScore).toBeNull();

    const noValue = await createTask(alice, {
      columnId,
      title: "Estimated, unvalued",
      estimate: 3,
    });
    expect(noValue.priorityScore).toBeNull();
  });

  it("rides task.updated, and clears with null", async () => {
    const task = await createTask(alice, {
      columnId,
      title: "Rescore me",
      value: 6,
      estimate: 3,
    });
    expect(task.priorityScore).toBe(2);

    const rescored = await updateTask(alice, task.id, { value: 9, risk: 0 });
    expect(rescored!.priorityScore).toBe(3);

    // The scoring inputs ride under task.updated (034), not an action of their own.
    const row = await queryOne<{ after: { value: number; risk: number } }>(
      `SELECT after FROM activity_log
        WHERE task_id = $1 AND action = 'task.updated'
        ORDER BY id DESC LIMIT 1`,
      [task.id]
    );
    expect(row!.after.value).toBe(9);

    // null unscores; the derived score follows to null.
    const cleared = await updateTask(alice, task.id, { value: null });
    expect(cleared!.value).toBeNull();
    expect(cleared!.priorityScore).toBeNull();
  });

  it("refuses a value outside 0–10 at the database CHECK", async () => {
    await expect(
      createTask(alice, { columnId, title: "Overscored", value: 11 })
    ).rejects.toThrow();
  });
});
