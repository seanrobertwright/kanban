import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getBoard } from "@/features/board/server/repository";
import { createTask } from "@/features/tasks/server/repository";
import { AuthzError } from "@/features/workspaces/server/authz";
import {
  addMember,
  createBoard,
  ensurePersonalWorkspace,
  getDefaultBoard,
} from "@/features/workspaces/server/repository";
import { pool, query } from "@/shared/db/client";
import { addDependency, getDependencies, removeDependency } from "./repository";

/**
 * The dependency graph's invariants — acyclic, same-board, tenant-sealed — are
 * all claims about what the recursive CTEs and role joins do against real rows,
 * so real Postgres throughout.
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

describe("dependencies", () => {
  let alice: string;
  let viewer: string;
  let stranger: string;
  let workspaceId: string;
  let columnId: number;
  let otherBoardColumnId: number;
  let strangerTaskId: number;

  beforeAll(async () => {
    alice = await createUser("dep-alice");
    viewer = await createUser("dep-viewer");
    stranger = await createUser("dep-stranger");

    workspaceId = (await ensurePersonalWorkspace(alice, "DepAlice")).id;
    await addMember(alice, workspaceId, viewer, "viewer");
    const boardId = (await getDefaultBoard(alice))!.id;
    columnId = (await getBoard(alice, boardId))!.columns[0].id;

    const boardB = await createBoard(alice, workspaceId, "Dep Board B");
    otherBoardColumnId = (await getBoard(alice, boardB.id))!.columns[0].id;

    await ensurePersonalWorkspace(stranger, "DepStranger");
    const strangerBoard = (await getDefaultBoard(stranger))!;
    const strangerColumn = (await getBoard(stranger, strangerBoard.id))!.columns[0].id;
    strangerTaskId = (
      await createTask(stranger, { columnId: strangerColumn, title: "Not yours" })
    ).id;
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
  const newTask = (title?: string, column = columnId) =>
    createTask(alice, { columnId: column, title: title ?? `dep-task-${(seq += 1)}` });

  describe("round-trip", () => {
    it("adds, lists, and removes a blocker", async () => {
      const task = await newTask("Blocked one");
      const blocker = await newTask("The blocker");

      await addDependency(alice, task.id, blocker.id);
      const listed = await getDependencies(alice, task.id);
      expect(listed.dependencies).toEqual([{ id: blocker.id, title: "The blocker" }]);

      expect(await removeDependency(alice, task.id, blocker.id)).toBe(true);
      expect((await getDependencies(alice, task.id)).dependencies).toEqual([]);
    });

    it("removing an edge that is not there answers false, not success", async () => {
      const [a, b] = [await newTask(), await newTask()];
      expect(await removeDependency(alice, a.id, b.id)).toBe(false);
    });

    it("re-adding an existing edge is an idempotent no-op", async () => {
      const [a, b] = [await newTask(), await newTask()];
      await addDependency(alice, a.id, b.id);
      await expect(addDependency(alice, a.id, b.id)).resolves.toBeUndefined();
      expect((await getDependencies(alice, a.id)).dependencies).toHaveLength(1);
    });
  });

  describe("the graph stays a DAG", () => {
    it("refuses a self-reference", async () => {
      const task = await newTask();
      await expect(addDependency(alice, task.id, task.id)).rejects.toMatchObject({
        kind: "conflict",
      });
    });

    it("refuses the two-node cycle", async () => {
      const [a, b] = [await newTask(), await newTask()];
      await addDependency(alice, a.id, b.id);
      await expect(addDependency(alice, b.id, a.id)).rejects.toMatchObject({
        kind: "conflict",
      });
    });

    it("refuses a transitive cycle across a chain", async () => {
      // a depends on b, b depends on c; making c depend on a closes the loop.
      const [a, b, c] = [await newTask(), await newTask(), await newTask()];
      await addDependency(alice, a.id, b.id);
      await addDependency(alice, b.id, c.id);
      await expect(addDependency(alice, c.id, a.id)).rejects.toMatchObject({
        kind: "conflict",
      });
      // And the refusal wrote nothing.
      expect((await getDependencies(alice, c.id)).dependencies).toEqual([]);
    });

    it("keeps would-cycle tasks out of the candidate list", async () => {
      const [a, b] = [await newTask("cand-blocked"), await newTask("cand-blocker")];
      await addDependency(alice, a.id, b.id);
      const forB = await getDependencies(alice, b.id);
      // b may not take a as a blocker: a already depends on b.
      expect(forB.candidates.map((t) => t.id)).not.toContain(a.id);
      // The existing blocker also stops being a candidate for a.
      const forA = await getDependencies(alice, a.id);
      expect(forA.candidates.map((t) => t.id)).not.toContain(b.id);
      expect(forA.candidates.map((t) => t.id)).not.toContain(a.id);
    });
  });

  describe("boards and tenancy", () => {
    it("refuses a blocker on a different board of the same workspace", async () => {
      const here = await newTask();
      const elsewhere = await newTask("On board B", otherBoardColumnId);
      await expect(
        addDependency(alice, here.id, elsewhere.id)
      ).rejects.toMatchObject({ kind: "forbidden" });
    });

    it("answers not_found for a blocker in a workspace the caller cannot see", async () => {
      const mine = await newTask();
      await expect(
        addDependency(alice, mine.id, strangerTaskId)
      ).rejects.toMatchObject({ kind: "not_found" });
    });

    it("answers not_found for the blocked task itself when it is unreachable", async () => {
      const mine = await newTask();
      await expect(
        addDependency(stranger, mine.id, strangerTaskId)
      ).rejects.toMatchObject({ kind: "not_found" });
      await expect(getDependencies(stranger, mine.id)).rejects.toMatchObject({
        kind: "not_found",
      });
    });

    it("candidates never reach outside the task's own board", async () => {
      const task = await newTask();
      const { candidates } = await getDependencies(alice, task.id);
      const ids = candidates.map((t) => t.id);
      expect(ids).not.toContain(strangerTaskId);
      const onOtherBoard = await query<{ id: number }>(
        `SELECT t.id FROM task t WHERE t.column_id = $1`,
        [otherBoardColumnId]
      );
      for (const other of onOtherBoard) expect(ids).not.toContain(other.id);
    });
  });

  describe("who may edit the graph", () => {
    it("lets a viewer read but not write", async () => {
      const [a, b] = [await newTask(), await newTask()];
      await addDependency(alice, a.id, b.id);
      const listed = await getDependencies(viewer, a.id);
      expect(listed.dependencies.map((t) => t.id)).toContain(b.id);

      const c = await newTask();
      await expect(addDependency(viewer, a.id, c.id)).rejects.toBeInstanceOf(
        AuthzError
      );
      await expect(removeDependency(viewer, a.id, b.id)).rejects.toBeInstanceOf(
        AuthzError
      );
    });
  });
});
