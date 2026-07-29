import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getBoard, setBoardDoneColumn } from "@/features/board/server/repository";
import { createTask, moveTask, updateTask } from "@/features/tasks/server/repository";
import {
  ensurePersonalWorkspace,
  getDefaultBoard,
} from "@/features/workspaces/server/repository";
import { pool, query } from "@/shared/db/client";
import { createEpic } from "@/features/epics/server/repository";
import {
  createMilestone,
  deleteMilestone,
  listMilestones,
  updateMilestone,
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
  let workspaceId: string;
  let boardId: number;
  let todoId: number;
  let doneId: number;
  const human = () => ({ type: "human" as const, id: alice });

  beforeAll(async () => {
    alice = await createUser("ms-alice");
    workspaceId = (await ensurePersonalWorkspace(alice, "MsAlice")).id;
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

  it("edits three-valued fields: absent leaves, null clears", async () => {
    const epic = await createEpic(alice, boardId, { name: "Platform" }, human());
    const milestone = await createMilestone(
      alice,
      boardId,
      { name: "Dated", dueDate: "2026-10-01", epicId: epic.id },
      human()
    );

    // A rename says nothing about the date or the epic, so both must survive —
    // the failure this guards against is a COALESCE-shaped update that treats
    // "not mentioned" as "set to null".
    const renamed = await updateMilestone(alice, milestone.id, { name: "Renamed" }, human());
    expect(renamed!.name).toBe("Renamed");
    expect(renamed!.dueDate).toBe("2026-10-01");
    expect(renamed!.epicId).toBe(epic.id);

    // Naming them as null is how they are cleared, which is the other half of
    // the same rule and impossible if the two cases were collapsed.
    const cleared = await updateMilestone(
      alice,
      milestone.id,
      { dueDate: null, epicId: null },
      human()
    );
    expect(cleared!.dueDate).toBeNull();
    expect(cleared!.epicId).toBeNull();
  });

  it("refuses another board's epic, and an unknown milestone", async () => {
    const bob = await createUser("ms-epic-bob");
    await ensurePersonalWorkspace(bob, "MsEpicBob");
    const bobBoard = (await getDefaultBoard(bob))!.id;
    const bobEpic = await createEpic(
      bob,
      bobBoard,
      { name: "Bob's epic" },
      { type: "human", id: bob }
    );

    await expect(
      createMilestone(alice, boardId, { name: "Cross", epicId: bobEpic.id }, human())
    ).rejects.toThrow(/not on this board/);

    const mine = await createMilestone(alice, boardId, { name: "Mine" }, human());
    await expect(
      updateMilestone(alice, mine.id, { epicId: bobEpic.id }, human())
    ).rejects.toThrow(/not on this board/);

    // An id nobody owns is not_found rather than a role error — the same answer
    // another workspace's milestone gets, so the id space says nothing.
    await expect(
      updateMilestone(alice, 2_000_000_000, { name: "Ghost" }, human())
    ).rejects.toThrow(/not found/i);
    await expect(
      deleteMilestone(alice, 2_000_000_000, human())
    ).rejects.toThrow(/not found/i);
  });

  it("lists dated milestones first, undated last", async () => {
    const fresh = await createUser("ms-order");
    await ensurePersonalWorkspace(fresh, "MsOrder");
    const freshBoard = (await getDefaultBoard(fresh))!.id;
    const by = { type: "human" as const, id: fresh };

    // Inserted deliberately out of order: the ORDER BY is the feature, and a
    // creation-order list would pass a weaker assertion by accident.
    await createMilestone(fresh, freshBoard, { name: "Someday" }, by);
    await createMilestone(fresh, freshBoard, { name: "Later", dueDate: "2027-01-01" }, by);
    await createMilestone(fresh, freshBoard, { name: "Soon", dueDate: "2026-01-01" }, by);

    expect((await listMilestones(fresh, freshBoard)).map((m) => m.name)).toEqual([
      "Soon",
      "Later",
      "Someday",
    ]);
  });

  it("a viewer reads milestones but cannot author them", async () => {
    const viewer = await createUser("ms-viewer");
    await query(
      `INSERT INTO workspace_member (workspace_id, user_id, role) VALUES ($1, $2, 'viewer')`,
      [workspaceId, viewer]
    );
    const milestone = await createMilestone(alice, boardId, { name: "Readable" }, human());

    expect(
      (await listMilestones(viewer, boardId)).some((m) => m.id === milestone.id)
    ).toBe(true);
    const asViewer = { type: "human" as const, id: viewer };
    await expect(
      createMilestone(viewer, boardId, { name: "Nope" }, asViewer)
    ).rejects.toThrow();
    await expect(
      updateMilestone(viewer, milestone.id, { name: "Nope" }, asViewer)
    ).rejects.toThrow();
    await expect(deleteMilestone(viewer, milestone.id, asViewer)).rejects.toThrow();
  });
});
