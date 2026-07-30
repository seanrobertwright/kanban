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
import {
  createTimeOff,
  deleteTimeOff,
  getBoardCapacity,
  setMemberCapacity,
} from "./repository";

/**
 * The utilization maths are unit-tested pure; the database facts here are the
 * demand rollup (open assigned estimate, done work excluded), the unassigned
 * bucket, the upsert, and the member guard (041) — plus, for 090, that a stored
 * absence reaches the plan's budget and that leave is only bookable and
 * revocable by its owner or an admin.
 */

/** A Thursday, so the pinned week (Mon 2026-07-27 – Sun 2026-08-02) has workdays
 *  on both sides of "today" and the reads are not date-of-run dependent. */
const TODAY = "2026-07-30";

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
  let bob: string;
  let workspaceId: string;
  let boardId: number;
  let todoId: number;
  let doneId: number;
  const human = () => ({ type: "human" as const, id: alice });

  beforeAll(async () => {
    alice = await createUser("cap-alice");
    bob = await createUser("cap-bob");
    await ensurePersonalWorkspace(alice, "CapAlice");
    workspaceId = (await listWorkspacesForUser(alice))[0].id;
    // Bob is a plain member: he may book his own leave, nobody else's.
    await query(
      `INSERT INTO workspace_member (workspace_id, user_id, role) VALUES ($1, $2, 'member')`,
      [workspaceId, bob]
    );
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

  it("prorates the plan's budget by time off in the read's week (090)", async () => {
    await setMemberCapacity(alice, workspaceId, alice, {
      weeklyPoints: 10,
      role: "Backend",
    });

    // Two of the pinned week's workdays, plus leave in a later month that must
    // ride along in the row without touching this week's number.
    const thisWeek = await createTimeOff(alice, workspaceId, {
      userId: alice,
      startsOn: "2026-07-28",
      endsOn: "2026-07-29",
      note: "Conference",
    });
    await createTimeOff(alice, workspaceId, {
      userId: alice,
      startsOn: "2026-09-07",
      endsOn: "2026-09-11",
    });

    const plan = await getBoardCapacity(alice, boardId, TODAY);
    expect(plan.week).toEqual({ start: "2026-07-27", end: "2026-08-02" });

    const aliceRow = plan.rows.find((r) => r.userId === alice)!;
    expect(aliceRow.weeklyPoints).toBe(10); // nominal, unchanged
    expect(aliceRow.daysOff).toBe(2);
    expect(aliceRow.availablePoints).toBe(6);
    expect(aliceRow.committedPoints).toBe(5);
    expect(aliceRow.utilization).toBeCloseTo(5 / 6);
    expect(aliceRow.timeOff.map((t) => t.startsOn)).toEqual([
      "2026-07-28",
      "2026-09-07",
    ]);
    expect(aliceRow.timeOff[0].note).toBe("Conference");
    expect(plan.totals).toMatchObject({ capacity: 10, available: 6, committed: 5 });

    await deleteTimeOff(alice, workspaceId, thisWeek.id);
    const after = await getBoardCapacity(alice, boardId, TODAY);
    expect(after.rows.find((r) => r.userId === alice)!.availablePoints).toBe(10);
  });

  it("lets a member book only their own leave", async () => {
    const own = await createTimeOff(bob, workspaceId, {
      userId: bob,
      startsOn: "2026-07-27",
      endsOn: "2026-07-27",
    });
    expect(own.userId).toBe(bob);

    await expect(
      createTimeOff(bob, workspaceId, {
        userId: alice,
        startsOn: "2026-07-27",
        endsOn: "2026-07-27",
      })
    ).rejects.toMatchObject({ kind: "forbidden" });
  });

  it("refuses booking leave for a non-member (not_found)", async () => {
    await expect(
      createTimeOff(alice, workspaceId, {
        userId: "test-stranger-nobody",
        startsOn: "2026-07-27",
        endsOn: "2026-07-27",
      })
    ).rejects.toMatchObject({ kind: "not_found" });
  });

  it("revokes leave for its owner or an admin, and nobody else", async () => {
    const aliceLeave = await createTimeOff(alice, workspaceId, {
      userId: alice,
      startsOn: "2026-07-31",
      endsOn: "2026-07-31",
    });

    // Bob is a member, not an admin: alice's entry is not his to cancel, and the
    // refusal is not_found so it cannot confirm the id exists.
    await expect(
      deleteTimeOff(bob, workspaceId, aliceLeave.id)
    ).rejects.toMatchObject({ kind: "not_found" });

    // Alice is the workspace admin, so she may cancel bob's.
    const bobLeave = await createTimeOff(bob, workspaceId, {
      userId: bob,
      startsOn: "2026-07-30",
      endsOn: "2026-07-30",
    });
    await expect(deleteTimeOff(alice, workspaceId, bobLeave.id)).resolves.toBeUndefined();
    await expect(
      deleteTimeOff(alice, workspaceId, bobLeave.id)
    ).rejects.toMatchObject({ kind: "not_found" });
  });
});
