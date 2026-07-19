import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getBoard } from "@/features/board/server/repository";
import { createTask } from "@/features/tasks/server/repository";
import {
  ensurePersonalWorkspace,
  getDefaultBoard,
} from "@/features/workspaces/server/repository";
import { pool, query } from "@/shared/db/client";
import { addTimeEntry, deleteTimeEntry, listTaskTime } from "./repository";

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

describe("time tracking", () => {
  let alice: string;
  let bob: string;
  let ws: string;
  let taskId: number;

  beforeAll(async () => {
    alice = await createUser("tt-alice");
    bob = await createUser("tt-bob");
    const workspace = await ensurePersonalWorkspace(alice, "TtAlice");
    ws = workspace.id;
    await query(
      `INSERT INTO workspace_member (workspace_id, user_id, role)
       VALUES ($1, $2, 'member')`,
      [ws, bob]
    );
    const boardId = (await getDefaultBoard(alice))!.id;
    const columnId = (await getBoard(alice, boardId))!.columns[0].id;
    taskId = (await createTask(alice, { columnId, title: "Timed" })).id;
  });

  afterAll(async () => {
    await query(`DELETE FROM workspace WHERE id = $1`, [ws]);
    await query(`DELETE FROM "user" WHERE id = ANY($1)`, [createdUsers]);
    await pool.end();
  });

  it("logs entries, totals them, and writes history rows", async () => {
    await addTimeEntry(alice, taskId, { minutes: 90, note: "wiring" });
    await addTimeEntry(bob, taskId, { minutes: 30, spentOn: "2026-07-18" });

    const time = await listTaskTime(alice, taskId);
    expect(time.totalMinutes).toBe(120);
    expect(time.entries).toHaveLength(2);
    const bobs = time.entries.find((e) => e.userId === bob)!;
    expect(bobs.spentOn).toBe("2026-07-18");
    // Alice owns the workspace, so she may delete Bob's entry; Bob may delete
    // his own but not hers — read from Bob's side.
    const bobView = await listTaskTime(bob, taskId);
    expect(bobView.entries.find((e) => e.userId === bob)!.canDelete).toBe(true);
    expect(bobView.entries.find((e) => e.userId === alice)!.canDelete).toBe(
      false
    );

    const { rows } = await pool.query(
      `SELECT after FROM activity_log
        WHERE task_id = $1 AND action = 'time.logged' ORDER BY id`,
      [taskId]
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].after.minutes).toBe(90);
  });

  it("a member cannot delete another's entry; the author can", async () => {
    const entry = await addTimeEntry(alice, taskId, { minutes: 15 });
    await expect(deleteTimeEntry(bob, entry.id)).rejects.toThrow(
      /author or an admin/
    );
    expect(await deleteTimeEntry(alice, entry.id)).toBe(true);

    const { rows } = await pool.query(
      `SELECT before FROM activity_log
        WHERE task_id = $1 AND action = 'time.deleted'`,
      [taskId]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].before.minutes).toBe(15);
  });

  it("the database refuses non-positive minutes", async () => {
    await expect(
      pool.query(
        `INSERT INTO time_entry (task_id, user_id, minutes) VALUES ($1, $2, 0)`,
        [taskId, alice]
      )
    ).rejects.toThrow(/check/i);
  });
});
