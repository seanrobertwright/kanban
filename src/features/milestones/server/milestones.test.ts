import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getBoard, setBoardDoneColumn } from "@/features/board/server/repository";
import { createTask, moveTask, updateTask } from "@/features/tasks/server/repository";
import {
  ensurePersonalWorkspace,
  getDefaultBoard,
} from "@/features/workspaces/server/repository";
import { pool, query } from "@/shared/db/client";
import {
  createMilestone,
  deleteMilestone,
  listMilestones,
} from "./repository";

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

describe("milestones", () => {
  let alice: string;
  let boardId: number;
  let todoId: number;
  let doneId: number;
  const human = () => ({ type: "human" as const, id: alice });

  beforeAll(async () => {
    alice = await createUser("ms-alice");
    await ensurePersonalWorkspace(alice, "MsAlice");
    boardId = (await getDefaultBoard(alice))!.id;
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

  it("creates, aims tasks, and reports progress against the done column", async () => {
    const milestone = await createMilestone(
      alice,
      boardId,
      { name: "v1.0", dueDate: "2026-09-01" },
      human()
    );

    const a = await createTask(alice, {
      columnId: todoId,
      title: "Aimed A",
      milestoneId: milestone.id,
    });
    expect(a.milestoneId).toBe(milestone.id);
    const b = await createTask(alice, { columnId: todoId, title: "Aimed B" });
    await updateTask(alice, b.id, { milestoneId: milestone.id });

    await moveTask(alice, a.id, { columnId: doneId, position: 0 });

    const listed = await listMilestones(alice, boardId);
    const v1 = listed.find((m) => m.id === milestone.id)!;
    expect(v1.total).toBe(2);
    expect(v1.done).toBe(1);

    // getBoard rides them along for the picker and the dialog.
    const board = (await getBoard(alice, boardId))!;
    expect(board.milestones.some((m) => m.id === milestone.id)).toBe(true);
  });

  it("refuses aiming at another board's milestone", async () => {
    const bob = await createUser("ms-bob");
    await ensurePersonalWorkspace(bob, "MsBob");
    const bobBoard = (await getDefaultBoard(bob))!.id;
    const bobCol = (await getBoard(bob, bobBoard))!.columns[0].id;
    const bobMilestone = await createMilestone(
      bob,
      bobBoard,
      { name: "Bob's v1" },
      { type: "human", id: bob }
    );

    await expect(
      createTask(alice, {
        columnId: todoId,
        title: "Cross-aim",
        milestoneId: bobMilestone.id,
      })
    ).rejects.toThrow(/not on this board/);
    void bobCol;
  });

  it("deleting un-aims tasks and logs, destroying nothing", async () => {
    const milestone = await createMilestone(
      alice,
      boardId,
      { name: "Doomed" },
      human()
    );
    const task = await createTask(alice, {
      columnId: todoId,
      title: "Survivor",
      milestoneId: milestone.id,
    });

    expect(await deleteMilestone(alice, milestone.id, human())).toBe(true);

    const { rows } = await pool.query(
      `SELECT milestone_id FROM task WHERE id = $1`,
      [task.id]
    );
    expect(rows[0].milestone_id).toBeNull();

    const log = await pool.query(
      `SELECT 1 FROM activity_log
        WHERE board_id = $1 AND action = 'milestone.deleted'`,
      [boardId]
    );
    expect(log.rows.length).toBeGreaterThan(0);
  });
});
