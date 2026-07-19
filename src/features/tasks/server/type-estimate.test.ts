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
 * Against a real Postgres, because 022's semantics are database semantics: the
 * enum refuses what the validator missed, the CHECK refuses a negative, and the
 * supplied-flag idiom for estimate is SQL a mock would happily misread. The
 * clear-vs-leave distinction is the thing worth holding to.
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

describe("task type and estimate", () => {
  let alice: string;
  let boardId: number;
  let columnId: number;

  beforeAll(async () => {
    alice = await createUser("te-alice");
    await ensurePersonalWorkspace(alice, "TeAlice");
    const board = (await getDefaultBoard(alice))!;
    boardId = board.id;
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

  it("defaults to a plain unestimated task", async () => {
    const task = await createTask(alice, { columnId, title: "Plain" });
    expect(task.type).toBe("task");
    expect(task.estimate).toBeNull();
  });

  it("creates with a kind and points, and reads them back", async () => {
    const task = await createTask(alice, {
      columnId,
      title: "Login crashes",
      type: "bug",
      estimate: 3,
    });
    expect(task.type).toBe("bug");
    expect(task.estimate).toBe(3);
  });

  it("updates each independently, and logs one task.updated for the pair", async () => {
    const task = await createTask(alice, { columnId, title: "Retype me" });

    const retyped = await updateTask(alice, task.id, {
      type: "story",
      estimate: 5,
    });
    expect(retyped!.type).toBe("story");
    expect(retyped!.estimate).toBe(5);

    // Both changes are details of one edit — one row, not two (022 rides under
    // task.updated), with the snapshots carrying the new fields for undo.
    const row = await queryOne<{ after: { type: string; estimate: number } }>(
      `SELECT after FROM activity_log
        WHERE task_id = $1 AND action = 'task.updated'
        ORDER BY id DESC LIMIT 1`,
      [task.id]
    );
    expect(row!.after.type).toBe("story");
    expect(row!.after.estimate).toBe(5);
  });

  it("clears an estimate with null, and leaves it alone when absent", async () => {
    const task = await createTask(alice, {
      columnId,
      title: "Estimated",
      estimate: 8,
    });

    // A title-only edit says nothing about the estimate — it must survive.
    const renamed = await updateTask(alice, task.id, { title: "Renamed" });
    expect(renamed!.estimate).toBe(8);

    // null is the cleared state, not "not supplied" — dueDate's rule (022).
    const cleared = await updateTask(alice, task.id, { estimate: null });
    expect(cleared!.estimate).toBeNull();
  });

  it("a no-op edit logs nothing", async () => {
    const task = await createTask(alice, {
      columnId,
      title: "Quiet",
      type: "bug",
      estimate: 2,
    });
    await updateTask(alice, task.id, { type: "bug", estimate: 2 });

    const { rows } = await pool.query(
      `SELECT 1 FROM activity_log WHERE task_id = $1 AND action = 'task.updated'`,
      [task.id]
    );
    expect(rows).toHaveLength(0);
  });
});
