import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getBoard } from "@/features/board/server/repository";
import { createTask, deleteTask } from "@/features/tasks/server/repository";
import { AuthzError } from "@/features/workspaces/server/authz";
import {
  addMember,
  ensurePersonalWorkspace,
  getDefaultBoard,
} from "@/features/workspaces/server/repository";
import { pool, query, queryOne } from "@/shared/db/client";
import {
  createChecklistItem,
  deleteChecklistItem,
  listChecklist,
  updateChecklistItem,
} from "./repository";

/**
 * Checklists are rows behind a task-role join and a MAX+1 position computed in
 * the INSERT; the tenancy answer and the cascade are both database facts, so
 * real Postgres.
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

describe("checklists", () => {
  let alice: string;
  let viewer: string;
  let stranger: string;
  let workspaceId: string;
  let columnId: number;

  beforeAll(async () => {
    alice = await createUser("chk-alice");
    viewer = await createUser("chk-viewer");
    stranger = await createUser("chk-stranger");

    workspaceId = (await ensurePersonalWorkspace(alice, "ChkAlice")).id;
    await addMember(alice, workspaceId, viewer, "viewer");
    await ensurePersonalWorkspace(stranger, "ChkStranger");

    const boardId = (await getDefaultBoard(alice))!.id;
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

  let seq = 0;
  const newTask = () =>
    createTask(alice, { columnId, title: `chk-task-${(seq += 1)}` });

  describe("round-trip", () => {
    it("creates, lists, updates, and deletes an item", async () => {
      const task = await newTask();
      const item = await createChecklistItem(alice, task.id, {
        content: "Write the test",
      });
      expect(item).toMatchObject({
        taskId: task.id,
        content: "Write the test",
        done: false,
        position: 0,
      });

      const listed = await listChecklist(alice, task.id);
      expect(listed).toHaveLength(1);
      expect(listed[0].id).toBe(item.id);

      const ticked = await updateChecklistItem(alice, item.id, { done: true });
      expect(ticked.done).toBe(true);
      expect(ticked.content).toBe("Write the test"); // absent field untouched

      const renamed = await updateChecklistItem(alice, item.id, {
        content: "Written",
      });
      expect(renamed).toMatchObject({ content: "Written", done: true });

      expect(await deleteChecklistItem(alice, item.id)).toBe(true);
      expect(await listChecklist(alice, task.id)).toEqual([]);
    });

    it("deleting an item that is gone answers false, not success", async () => {
      const task = await newTask();
      const item = await createChecklistItem(alice, task.id, { content: "x" });
      expect(await deleteChecklistItem(alice, item.id)).toBe(true);
      expect(await deleteChecklistItem(alice, item.id)).toBe(false);
    });
  });

  describe("ordering", () => {
    it("appends with increasing positions and lists in that order", async () => {
      const task = await newTask();
      const first = await createChecklistItem(alice, task.id, { content: "first" });
      const second = await createChecklistItem(alice, task.id, { content: "second" });
      const third = await createChecklistItem(alice, task.id, { content: "third" });
      expect([first.position, second.position, third.position]).toEqual([0, 1, 2]);

      const listed = await listChecklist(alice, task.id);
      expect(listed.map((i) => i.content)).toEqual(["first", "second", "third"]);
    });

    it("appends after the surviving rows when the tail is deleted", async () => {
      // position is MAX(position)+1 over what is still there, so deleting the
      // last item frees its slot for the next one. Position orders a list; it
      // is not an identity, and nothing outside ORDER BY reads it.
      const task = await newTask();
      await createChecklistItem(alice, task.id, { content: "a" });
      const b = await createChecklistItem(alice, task.id, { content: "b" });
      await deleteChecklistItem(alice, b.id);
      const c = await createChecklistItem(alice, task.id, { content: "c" });
      expect(c.position).toBe(1);
      expect((await listChecklist(alice, task.id)).map((i) => i.content)).toEqual([
        "a",
        "c",
      ]);
      // Two tasks' checklists are independent sequences.
      const other = await newTask();
      const fresh = await createChecklistItem(alice, other.id, { content: "z" });
      expect(fresh.position).toBe(0);
    });
  });

  describe("who may touch a checklist", () => {
    it("lets a viewer read but refuses every write", async () => {
      const task = await newTask();
      const item = await createChecklistItem(alice, task.id, { content: "vw" });

      expect((await listChecklist(viewer, task.id)).map((i) => i.id)).toContain(
        item.id
      );
      await expect(
        createChecklistItem(viewer, task.id, { content: "nope" })
      ).rejects.toBeInstanceOf(AuthzError);
      await expect(
        updateChecklistItem(viewer, item.id, { done: true })
      ).rejects.toBeInstanceOf(AuthzError);
      await expect(deleteChecklistItem(viewer, item.id)).rejects.toBeInstanceOf(
        AuthzError
      );
    });

    it("answers not_found across the tenancy boundary, for task and item alike", async () => {
      const task = await newTask();
      const item = await createChecklistItem(alice, task.id, { content: "sealed" });

      await expect(listChecklist(stranger, task.id)).rejects.toMatchObject({
        kind: "not_found",
      });
      await expect(
        createChecklistItem(stranger, task.id, { content: "smuggled" })
      ).rejects.toMatchObject({ kind: "not_found" });
      await expect(
        updateChecklistItem(stranger, item.id, { done: true })
      ).rejects.toMatchObject({ kind: "not_found" });
      // Delete folds the unreachable case into false — same no-oracle answer.
      expect(await deleteChecklistItem(stranger, item.id)).toBe(false);
      // And nothing changed.
      const kept = await listChecklist(alice, task.id);
      expect(kept).toHaveLength(1);
      expect(kept[0].done).toBe(false);
    });
  });

  describe("lifecycle", () => {
    it("cascades away with its task", async () => {
      const task = await newTask();
      const a = await createChecklistItem(alice, task.id, { content: "going" });
      const b = await createChecklistItem(alice, task.id, { content: "gone" });

      expect(await deleteTask(alice, task.id)).toBe(true);

      const rows = await queryOne<{ n: string }>(
        `SELECT count(*) AS n FROM checklist_item WHERE id = ANY($1)`,
        [[a.id, b.id]]
      );
      expect(Number(rows!.n)).toBe(0);
    });
  });
});
