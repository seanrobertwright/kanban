import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getBoard, setBoardDoneColumn } from "@/features/board/server/repository";
import { createTask, moveTask } from "@/features/tasks/server/repository";
import { createMilestone } from "@/features/milestones/server/repository";
import {
  ensurePersonalWorkspace,
  getDefaultBoard,
} from "@/features/workspaces/server/repository";
import type { EpicSnapshot } from "@/features/activity/types";
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

  it("defaults to active and unowned, and takes a status and owner on create", async () => {
    const plain = await createEpic(alice, boardId, { name: "Plain" }, human());
    // The migration's backfill promise, stated as a test: an epic nobody has
    // said anything about is active, not proposed, and belongs to no one.
    expect(plain.status).toBe("active");
    expect(plain.ownerId).toBeNull();
    expect(plain.ownerName).toBeNull();

    const owned = await createEpic(
      alice,
      boardId,
      { name: "Owned", status: "proposed", ownerId: alice },
      human()
    );
    expect(owned.status).toBe("proposed");
    expect(owned.ownerId).toBe(alice);
    // The name rides the read so a list can paint an owner without a join.
    expect(owned.ownerName).toBe("Test ep-alice");
  });

  it("moves through the four statuses in any order — it is a field, not a lifecycle", async () => {
    const epic = await createEpic(alice, boardId, { name: "Free" }, human());
    // Done and back to active is the case a sprint's lifecycle would refuse and
    // an epic must not: a bucket reopens when more work turns up in it.
    for (const status of ["done", "active", "paused", "proposed"] as const) {
      const moved = await updateEpic(alice, epic.id, { status }, human());
      expect(moved!.status).toBe(status);
    }
    await expect(
      query(`UPDATE epic SET status = 'shipped' WHERE id = $1`, [epic.id])
    ).rejects.toThrow();
  });

  it("owns, un-owns, and refuses an owner from another workspace", async () => {
    const bob = await createUser("ep-owner-bob");
    await ensurePersonalWorkspace(bob, "EpOwnerBob");
    const epic = await createEpic(alice, boardId, { name: "Ownable" }, human());

    // The three-valued rule: absent leaves the owner, null clears it.
    const owned = await updateEpic(alice, epic.id, { ownerId: alice }, human());
    expect(owned!.ownerId).toBe(alice);
    const renamedOnly = await updateEpic(
      alice,
      epic.id,
      { name: "Still ownable" },
      human()
    );
    expect(renamedOnly!.ownerId).toBe(alice);
    const unowned = await updateEpic(alice, epic.id, { ownerId: null }, human());
    expect(unowned!.ownerId).toBeNull();

    // The FK proves bob exists; it cannot prove he is in this workspace. Without
    // assertOwnerIsMember his name would render on a board he cannot open.
    await expect(
      updateEpic(alice, epic.id, { ownerId: bob }, human())
    ).rejects.toThrow(/not a member/i);
    await expect(
      createEpic(alice, boardId, { name: "Cross", ownerId: bob }, human())
    ).rejects.toThrow(/not a member/i);
  });

  it("survives its owner's deletion, keeping the epic and losing only the name", async () => {
    const leaver = await createUser("ep-leaver");
    const workspaceId = (await ensurePersonalWorkspace(alice, "EpAlice")).id;
    await query(
      `INSERT INTO workspace_member (workspace_id, user_id, role) VALUES ($1, $2, 'member')`,
      [workspaceId, leaver]
    );
    const epic = await createEpic(
      alice,
      boardId,
      { name: "Outlives", ownerId: leaver },
      human()
    );

    await query(`DELETE FROM "user" WHERE id = $1`, [leaver]);

    const after = (await listEpics(alice, boardId)).find((e) => e.id === epic.id);
    // SET NULL, not CASCADE: losing the owner must not lose the epic, and the
    // LEFT join is what keeps it listable with a null name rather than dropping
    // it out of the list entirely.
    expect(after).toBeDefined();
    expect(after!.ownerId).toBeNull();
    expect(after!.ownerName).toBeNull();
  });

  it("reads its window from the work inside it, and says null when nothing is dated", async () => {
    const epic = await createEpic(alice, boardId, { name: "Windowed" }, human());
    const undated = (await listEpics(alice, boardId)).find(
      (e) => e.id === epic.id
    )!;
    expect(undated.startDate).toBeNull();
    expect(undated.targetDate).toBeNull();

    // Two direct tasks bracket the window from below and above.
    await createTask(alice, {
      columnId: todoId,
      title: "Starts first",
      epicId: epic.id,
      startDate: "2026-08-03",
      dueDate: "2026-08-20",
    });
    await createTask(alice, {
      columnId: todoId,
      title: "Starts later",
      epicId: epic.id,
      startDate: "2026-08-11",
      dueDate: "2026-08-25",
    });
    // A milestone dated beyond every task, with nothing broken down under it —
    // the ordinary state of a plan, and the case reading only tasks would miss.
    await createMilestone(
      alice,
      boardId,
      { name: "Ships", dueDate: "2026-09-30", epicId: epic.id },
      human()
    );

    const dated = (await listEpics(alice, boardId)).find((e) => e.id === epic.id)!;
    expect(dated.startDate).toBe("2026-08-03");
    expect(dated.targetDate).toBe("2026-09-30");

    // getBoard reads the same SQL, so the dialog and the board cannot disagree.
    const onBoard = (await getBoard(alice, boardId))!.epics.find(
      (e) => e.id === epic.id
    )!;
    expect(onBoard.startDate).toBe("2026-08-03");
    expect(onBoard.targetDate).toBe("2026-09-30");
    expect(onBoard.status).toBe("active");
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

    // 089 gives the no-op rule two more ways to fire: re-sending the status an
    // epic already has, and an edit that names nothing at all.
    await updateEpic(alice, epic.id, { status: "active" }, human());
    await updateEpic(alice, epic.id, {}, human());
    expect(await logged()).toBe(before);

    const renamed = await updateEpic(alice, epic.id, { name: "Renamed" }, human());
    expect(renamed!.name).toBe("Renamed");
    expect(await logged()).toBe(before + 1);

    // The snapshot carries the stored fields, so parking an epic writes an
    // entry whose before and after actually differ — an 'epic.updated' with
    // identical halves reads as a bug in the log, not an edit.
    await updateEpic(alice, epic.id, { status: "paused" }, human());
    const [entry] = await query<{ before: EpicSnapshot; after: EpicSnapshot }>(
      `SELECT before, after FROM activity_log
        WHERE board_id = $1 AND action = 'epic.updated'
        ORDER BY created_at DESC, id DESC LIMIT 1`,
      [boardId]
    );
    expect(entry.before.status).toBe("active");
    expect(entry.after.status).toBe("paused");
    expect(entry.after.name).toBe("Renamed");
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
