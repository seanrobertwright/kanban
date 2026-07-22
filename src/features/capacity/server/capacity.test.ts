import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getBoard, setBoardDoneColumn } from "@/features/board/server/repository";
import { createTask, moveTask } from "@/features/tasks/server/repository";
import {
  ensurePersonalWorkspace,
  getDefaultBoard,
  listWorkspacesForUser,
} from "@/features/workspaces/server/repository";
import { pool, query } from "@/shared/db/client";
import { getBoardCapacity, setMemberCapacity } from "./repository";

/**
 * The utilization maths are unit-tested pure; the database facts here are the
 * demand rollup (open assigned estimate, done work excluded), the unassigned
 * bucket, the upsert, and the member guard (041).
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

describe("capacity", () => {
  let alice: string;
  let workspaceId: string;
  let boardId: number;
  let todoId: number;
  let doneId: number;
  const human = () => ({ type: "human" as const, id: alice });

  beforeAll(async () => {
    alice = await createUser("cap-alice");
    await ensurePersonalWorkspace(alice, "CapAlice");
    workspaceId = (await listWorkspacesForUser(alice))[0].id;
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

  it("measures open assigned demand against a member's budget", async () => {
    // 5 open points on alice; 3 more but done (excluded); 8 unassigned.
    await createTask(alice, {
      columnId: todoId,
      title: "Open assigned",
      assignee: human(),
      estimate: 5,
    });
    const done = await createTask(alice, {
      columnId: todoId,
      title: "Done assigned",
      assignee: human(),
      estimate: 3,
    });
    await moveTask(alice, done.id, { columnId: doneId, position: 0 });
    await createTask(alice, {
      columnId: todoId,
      title: "Unassigned",
      estimate: 8,
    });

    await setMemberCapacity(alice, workspaceId, alice, {
      weeklyPoints: 10,
      role: "Backend",
    });

    const plan = await getBoardCapacity(alice, boardId);
    const aliceRow = plan.rows.find((r) => r.userId === alice)!;
    expect(aliceRow.role).toBe("Backend");
    expect(aliceRow.weeklyPoints).toBe(10);
    expect(aliceRow.committedPoints).toBe(5); // done work excluded
    expect(aliceRow.openTasks).toBe(1);
    expect(aliceRow.utilization).toBe(0.5);

    expect(plan.unassigned.points).toBe(8);
    expect(plan.unassigned.tasks).toBe(1);
    expect(plan.totals).toMatchObject({ capacity: 10, committed: 5 });
  });

  it("upserts a member's capacity and reports null utilization when unset", async () => {
    // Overwrite alice to 0 budget → utilization null even with demand.
    await setMemberCapacity(alice, workspaceId, alice, { weeklyPoints: 0, role: "" });
    const plan = await getBoardCapacity(alice, boardId);
    const aliceRow = plan.rows.find((r) => r.userId === alice)!;
    expect(aliceRow.weeklyPoints).toBe(0);
    expect(aliceRow.utilization).toBeNull();
  });

  it("refuses setting capacity for a non-member (not_found)", async () => {
    await expect(
      setMemberCapacity(alice, workspaceId, "test-stranger-nobody", {
        weeklyPoints: 5,
        role: "",
      })
    ).rejects.toMatchObject({ kind: "not_found" });
  });
});
