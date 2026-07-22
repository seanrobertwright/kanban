import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getBoard, setBoardWorkflow } from "@/features/board/server/repository";
import {
  ensurePersonalWorkspace,
  getDefaultBoard,
} from "@/features/workspaces/server/repository";
import { pool, query } from "@/shared/db/client";
import { createTask, moveTask } from "@/features/tasks/server/repository";
import { edgeKey } from "../types";

/**
 * State transition rules (046, rock 1.3): moveTask consults the board's
 * transition map — an unlisted edge is refused (409), a guarded edge is crossed
 * only when its condition holds, and clearing the map restores any→any.
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

describe("board workflow (db)", () => {
  let alice: string;
  let boardId: number;
  let col1: number;
  let col2: number;
  let col3: number;

  beforeAll(async () => {
    alice = await createUser("wf-alice");
    await ensurePersonalWorkspace(alice, "WfAlice");
    boardId = (await getDefaultBoard(alice))!.id;
    const cols = (await getBoard(alice, boardId))!.columns;
    [col1, col2, col3] = [cols[0].id, cols[1].id, cols[2].id];
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

  it("refuses a transition not in the allowed map, allows a listed one", async () => {
    await setBoardWorkflow(alice, boardId, {
      allowed: { [col1]: [col2], [col2]: [col3] },
    });
    const task = await createTask(alice, { columnId: col1, title: "flows" });

    // col1 → col3 is not listed → refused.
    await expect(
      moveTask(alice, task.id, { columnId: col3, position: 0 })
    ).rejects.toThrow(/not allowed/i);

    // col1 → col2 is listed → allowed.
    const moved = await moveTask(alice, task.id, { columnId: col2, position: 0 });
    expect(moved!.columnId).toBe(col2);
  });

  it("enforces an edge guard, then clears the map", async () => {
    // col2 → col3 only when priority is urgent.
    await setBoardWorkflow(alice, boardId, {
      allowed: { [col2]: [col3] },
      guards: { [edgeKey(col2, col3)]: { field: "priority", op: "eq", value: "urgent" } },
    });
    const task = await createTask(alice, {
      columnId: col2,
      title: "guarded",
      priority: "low",
    });
    await expect(
      moveTask(alice, task.id, { columnId: col3, position: 0 })
    ).rejects.toThrow(/conditions/i);

    // Clearing the workflow restores any → any.
    await setBoardWorkflow(alice, boardId, null);
    const moved = await moveTask(alice, task.id, { columnId: col3, position: 0 });
    expect(moved!.columnId).toBe(col3);
  });
});
