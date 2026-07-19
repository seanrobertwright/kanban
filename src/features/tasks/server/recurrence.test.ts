import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getBoard, setBoardDoneColumn } from "@/features/board/server/repository";
import {
  ensurePersonalWorkspace,
  getDefaultBoard,
} from "@/features/workspaces/server/repository";
import { pool, query } from "@/shared/db/client";
import { createTask, getTask, moveTask } from "./repository";

/**
 * Against a real Postgres, because the spawn is exactly the kind of thing a mock
 * would agree with while proving nothing: a JS crossing test wired to inline SQL
 * that copies a task, advances a date with interval arithmetic, and hands a
 * unique row (the recurrence) from one task to another inside the move's
 * transaction. 020's design is that invariant, and this is where it is held to it.
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

describe("recurrence", () => {
  let alice: string;
  let boardId: number;
  let todoId: number;
  let doneId: number;

  beforeAll(async () => {
    alice = await createUser("rec-alice");
    await ensurePersonalWorkspace(alice, "RecAlice");
    const board = (await getDefaultBoard(alice))!;
    boardId = board.id;
    const cols = (await getBoard(alice, boardId))!.columns;
    todoId = cols[0].id;
    doneId = cols[cols.length - 1].id;
    await setBoardDoneColumn(alice, boardId, doneId);
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

  async function tasksIn(columnId: number) {
    return (await getBoard(alice, boardId))!.tasks.filter(
      (t) => t.columnId === columnId
    );
  }

  it("spawns a successor when a recurring task crosses into the done column", async () => {
    const task = await createTask(alice, {
      columnId: todoId,
      title: "Weekly report",
      priority: "high",
      dueDate: "2026-01-31",
      recurrence: "weekly",
    });
    expect(task.recurrence).toBe("weekly");

    await moveTask(alice, task.id, { columnId: doneId, position: 0 });

    // The successor lands in the first column, carrying the shape and a date
    // advanced one week — Jan 31 + 7 days.
    const successors = (await tasksIn(todoId)).filter(
      (t) => t.title === "Weekly report" && t.id !== task.id
    );
    expect(successors).toHaveLength(1);
    expect(successors[0].priority).toBe("high");
    expect(successors[0].dueDate).toBe("2026-02-07");
    expect(successors[0].recurrence).toBe("weekly");

    // The rule moved: the completed task in Done no longer recurs, so dragging it
    // around cannot spawn again.
    const completed = await getTask(alice, task.id);
    expect(completed!.recurrence).toBeNull();
  });

  it("carries the label set to the successor", async () => {
    const task = await createTask(alice, {
      columnId: todoId,
      title: "Labelled recurring",
      recurrence: "daily",
    });
    // A label from this workspace, applied through the normal path.
    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO label (workspace_id, name, color)
       SELECT workspace_id, 'rec-lbl', 'sky' FROM board WHERE id = $1
       RETURNING id`,
      [boardId]
    );
    const labelId = rows[0].id;
    await query(`INSERT INTO task_label (task_id, label_id) VALUES ($1, $2)`, [
      task.id,
      labelId,
    ]);

    await moveTask(alice, task.id, { columnId: doneId, position: 0 });

    const successor = (await tasksIn(todoId)).find(
      (t) => t.title === "Labelled recurring" && t.id !== task.id
    );
    expect(successor).toBeDefined();
    expect(successor!.labels.map((l) => l.id)).toContain(labelId);
  });

  it("does not spawn for a one-off task moved into done", async () => {
    const task = await createTask(alice, {
      columnId: todoId,
      title: "One-off",
    });
    const before = (await tasksIn(todoId)).length;
    await moveTask(alice, task.id, { columnId: doneId, position: 0 });
    const after = (await tasksIn(todoId)).length;
    // One left todo (the moved task), none was born — so the count drops by one.
    expect(after).toBe(before - 1);
  });

  it("does not double-spawn when reordered within the done column", async () => {
    const task = await createTask(alice, {
      columnId: todoId,
      title: "Reorder me",
      recurrence: "monthly",
    });
    await moveTask(alice, task.id, { columnId: doneId, position: 0 });
    const afterFirst = (await tasksIn(todoId)).filter(
      (t) => t.title === "Reorder me"
    ).length;

    // Move the now-non-recurring completed task around within Done. It no longer
    // carries the rule, so nothing new is born.
    await moveTask(alice, task.id, { columnId: doneId, position: 0 });
    const afterSecond = (await tasksIn(todoId)).filter(
      (t) => t.title === "Reorder me"
    ).length;
    expect(afterSecond).toBe(afterFirst);
  });
});
