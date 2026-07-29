import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getBoard, setBoardDoneColumn } from "@/features/board/server/repository";
import { createTask, moveTask } from "@/features/tasks/server/repository";
import {
  createMilestone,
  updateMilestone,
} from "@/features/milestones/server/repository";
import {
  ensurePersonalWorkspace,
  getDefaultBoard,
} from "@/features/workspaces/server/repository";
import { pool, query } from "@/shared/db/client";
import { createEpic, deleteEpic, listEpics, updateEpic } from "./repository";

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

describe("epics", () => {
  let alice: string;
  let boardId: number;
  let todoId: number;
  let doneId: number;
  const human = () => ({ type: "human" as const, id: alice });

  beforeAll(async () => {
    alice = await createUser("ep-alice");
    await ensurePersonalWorkspace(alice, "EpAlice");
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

  it("rolls up direct tasks and member-milestone tasks against the done column", async () => {
    const epic = await createEpic(alice, boardId, { name: "Billing" }, human());

    // A task filed on the epic directly, moved to done.
    const direct = await createTask(alice, {
      columnId: todoId,
      title: "Direct",
      epicId: epic.id,
    });
    expect(direct.epicId).toBe(epic.id);
    await moveTask(alice, direct.id, { columnId: doneId, position: 0 });

    // A task that reaches the epic only through a milestone filed under it —
    // the "above the milestone" rollup. Left in todo, so it counts to total
    // but not to done.
    const milestone = await createMilestone(
      alice,
      boardId,
      { name: "v1.0", epicId: epic.id },
      human()
    );
    expect(milestone.epicId).toBe(epic.id);
    await createTask(alice, {
      columnId: todoId,
      title: "Via milestone",
      milestoneId: milestone.id,
    });

    // A task in neither the epic nor a member milestone — the control.
    await createTask(alice, { columnId: todoId, title: "Unrelated" });

    const listed = await listEpics(alice, boardId);
    const billing = listed.find((e) => e.id === epic.id)!;
    expect(billing.total).toBe(2);
    expect(billing.done).toBe(1);

    // getBoard rides them along for the picker and the dialog.
    const board = (await getBoard(alice, boardId))!;
    expect(board.epics.some((e) => e.id === epic.id)).toBe(true);
  });

  it("counts a task reachable both directly and via a milestone only once", async () => {
    const epic = await createEpic(alice, boardId, { name: "Onboarding" }, human());
    const milestone = await createMilestone(
      alice,
      boardId,
      { name: "Beta", epicId: epic.id },
      human()
    );
    // Filed on the epic AND on a milestone of the epic — the OR must not
    // double-count it.
    await createTask(alice, {
      columnId: todoId,
      title: "Both paths",
      epicId: epic.id,
      milestoneId: milestone.id,
    });

    const listed = await listEpics(alice, boardId);
    const onboarding = listed.find((e) => e.id === epic.id)!;
    expect(onboarding.total).toBe(1);
  });

  it("refuses filing a task under another board's epic", async () => {
    const bob = await createUser("ep-bob");
    await ensurePersonalWorkspace(bob, "EpBob");
    const bobBoard = (await getDefaultBoard(bob))!.id;
    const bobEpic = await createEpic(
      bob,
      bobBoard,
      { name: "Bob's epic" },
      { type: "human", id: bob }
    );

    await expect(
      createTask(alice, {
        columnId: todoId,
        title: "Cross-file",
        epicId: bobEpic.id,
      })
    ).rejects.toThrow(/not on this board/);
  });

  it("deleting un-files tasks and milestones and logs, destroying nothing", async () => {
    const epic = await createEpic(alice, boardId, { name: "Doomed" }, human());
    const task = await createTask(alice, {
      columnId: todoId,
      title: "Survivor",
      epicId: epic.id,
    });
    const milestone = await createMilestone(
      alice,
      boardId,
      { name: "Also survives", epicId: epic.id },
      human()
    );

    expect(await deleteEpic(alice, epic.id, human())).toBe(true);

    const t = await pool.query(`SELECT epic_id FROM task WHERE id = $1`, [
      task.id,
    ]);
    expect(t.rows[0].epic_id).toBeNull();
    const m = await pool.query(`SELECT epic_id FROM milestone WHERE id = $1`, [
      milestone.id,
    ]);
    expect(m.rows[0].epic_id).toBeNull();

    const log = await pool.query(
      `SELECT 1 FROM activity_log
        WHERE board_id = $1 AND action = 'epic.deleted'`,
      [boardId]
    );
    expect(log.rows.length).toBeGreaterThan(0);
  });

  it("renames, and a no-op rename writes no history", async () => {
    const epic = await createEpic(alice, boardId, { name: "Original" }, human());
    const logged = async () =>
      Number(
        (
          await query<{ n: string }>(
            `SELECT count(*) AS n FROM activity_log
              WHERE board_id = $1 AND action = 'epic.updated'`,
            [boardId]
          )
        )[0].n
      );

    const before = await logged();
    // Saving a form without changing anything is the commonest edit there is;
    // it must not add a row to a feed people read to see what changed.
    const unchanged = await updateEpic(alice, epic.id, { name: "Original" }, human());
    expect(unchanged!.name).toBe("Original");
    expect(await logged()).toBe(before);

    const renamed = await updateEpic(alice, epic.id, { name: "Renamed" }, human());
    expect(renamed!.name).toBe("Renamed");
    expect(await logged()).toBe(before + 1);
  });

  it("lists alphabetically and answers not_found for an epic nobody owns", async () => {
    const fresh = await createUser("ep-order");
    await ensurePersonalWorkspace(fresh, "EpOrder");
    const freshBoard = (await getDefaultBoard(fresh))!.id;
    const by = { type: "human" as const, id: fresh };

    // An epic has no due date to sort on, so name order is the whole contract —
    // inserted out of order so creation order cannot pass by accident.
    for (const name of ["Zeta", "Alpha", "Mu"]) {
      await createEpic(fresh, freshBoard, { name }, by);
    }
    expect((await listEpics(fresh, freshBoard)).map((e) => e.name)).toEqual([
      "Alpha",
      "Mu",
      "Zeta",
    ]);

    await expect(
      updateEpic(alice, 2_000_000_000, { name: "Ghost" }, human())
    ).rejects.toThrow(/not found/i);
    await expect(
      deleteEpic(alice, 2_000_000_000, human())
    ).rejects.toThrow(/not found/i);
  });

  it("a viewer reads epics but cannot author them", async () => {
    const viewer = await createUser("ep-viewer");
    const workspaceId = (await ensurePersonalWorkspace(alice, "EpAlice")).id;
    await query(
      `INSERT INTO workspace_member (workspace_id, user_id, role) VALUES ($1, $2, 'viewer')`,
      [workspaceId, viewer]
    );
    const epic = await createEpic(alice, boardId, { name: "Readable" }, human());
    const asViewer = { type: "human" as const, id: viewer };

    expect((await listEpics(viewer, boardId)).some((e) => e.id === epic.id)).toBe(true);
    await expect(
      createEpic(viewer, boardId, { name: "Nope" }, asViewer)
    ).rejects.toThrow();
    await expect(
      updateEpic(viewer, epic.id, { name: "Nope" }, asViewer)
    ).rejects.toThrow();
    await expect(deleteEpic(viewer, epic.id, asViewer)).rejects.toThrow();
  });
});
