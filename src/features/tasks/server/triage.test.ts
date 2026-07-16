import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { listRawActivityForTask } from "@/features/activity/server/repository";
import { getBoard } from "@/features/board/server/repository";
import {
  ensurePersonalWorkspace,
  getDefaultBoard,
} from "@/features/workspaces/server/repository";
import { pool, query } from "@/shared/db/client";
import { createTask, updateTask } from "./repository";

/**
 * Against a real Postgres, for the reason the assignee tests are: most of what
 * is asserted here is what the *database* does. That an enum sorts by
 * declaration order, that a DATE comes back as the day it went in rather than
 * the day before, and that COALESCE cannot express a clear are all facts about
 * Postgres and its driver. A mocked client would agree with every one of these
 * and prove none of them.
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

describe("priority and due dates", () => {
  let alice: string;
  let todoId: number;

  beforeAll(async () => {
    alice = await createUser("tri-alice");
    await ensurePersonalWorkspace(alice, "TriAlice");
    const boardId = (await getDefaultBoard(alice))!.id;
    todoId = (await getBoard(alice, boardId))!.columns[0].id;
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

  const newTask = (over: Record<string, unknown> = {}) =>
    createTask(alice, { columnId: todoId, title: "A task", ...over });

  const actionsFor = async (taskId: number) =>
    (await listRawActivityForTask(taskId)).map((e) => e.action);

  describe("priority", () => {
    it("defaults to none rather than null", async () => {
      // The whole two-valued-update design rests on this: if the column were
      // nullable, null would mean both "no priority" and "not supplied", and
      // updateTask would need the supplied-flag dance dueDate uses.
      const task = await newTask();
      expect(task.priority).toBe("none");
    });

    it("is set at creation time", async () => {
      const task = await newTask({ priority: "urgent" });
      expect(task.priority).toBe("urgent");
    });

    it("is cleared by setting none, not by setting null", async () => {
      const task = await newTask({ priority: "high" });
      const cleared = await updateTask(alice, task.id, { priority: "none" });
      expect(cleared!.priority).toBe("none");
    });

    it("leaves the priority alone when the field is absent", async () => {
      // The COALESCE branch. The dialog PATCHes title and priority together, but
      // an agent's tool call at M2 may well send one field — and a PATCH that
      // never mentions priority must not reset it.
      const task = await newTask({ priority: "urgent" });
      const renamed = await updateTask(alice, task.id, { title: "Renamed" });
      expect(renamed!.priority).toBe("urgent");
    });

    it("sorts by declaration order, not alphabetically", async () => {
      // This is the reason priority is an enum rather than TEXT, and it is worth
      // a test because TEXT would pass every other test in this file and fail
      // only here — alphabetically 'urgent' sorts after 'none', so a board
      // ordered by priority would look almost right.
      const ids: number[] = [];
      for (const priority of ["low", "urgent", "none", "high", "medium"]) {
        ids.push((await newTask({ title: `p-${priority}`, priority })).id);
      }
      const { rows } = await pool.query<{ priority: string }>(
        `SELECT priority FROM task WHERE id = ANY($1::int[])
          ORDER BY priority DESC`,
        [ids]
      );
      expect(rows.map((r) => r.priority)).toEqual([
        "urgent",
        "high",
        "medium",
        "low",
        "none",
      ]);
    });

    it("logs task.prioritized, separately from the edit beside it", async () => {
      // M2's changeset review accepts or rejects an agent's actions in parts, so
      // "set priority to Urgent" and "rewrote the description" must be two rows.
      // One PATCH, two events.
      const task = await newTask();
      await updateTask(alice, task.id, {
        title: "Renamed and prioritized",
        priority: "urgent",
      });
      const actions = await actionsFor(task.id);
      expect(actions).toContain("task.prioritized");
      expect(actions).toContain("task.updated");
    });

    it("does not log when the priority does not change", async () => {
      const task = await newTask({ priority: "low" });
      await updateTask(alice, task.id, { priority: "low" });
      expect(await actionsFor(task.id)).not.toContain("task.prioritized");
    });
  });

  describe("due dates", () => {
    it("survives the round trip as the same calendar day", async () => {
      // The test this file exists for. node-postgres parses DATE into a JS Date
      // at local midnight, which serializes to the previous day anywhere east of
      // Greenwich — so without the DATE type parser in shared/db/client.ts, this
      // fails for half the planet and passes in CI. Asserting a string rather
      // than a Date is itself part of the assertion.
      const task = await newTask({ dueDate: "2026-08-01" });
      expect(task.dueDate).toBe("2026-08-01");
    });

    it("comes back as a string, never a Date", async () => {
      // Stated separately because it is the property everything downstream
      // relies on: the client compares and formats these lexicographically, and
      // a Date would both break that and drag a timezone back in.
      const task = await newTask({ dueDate: "2026-12-31" });
      expect(typeof task.dueDate).toBe("string");
    });

    it("defaults to null", async () => {
      expect((await newTask()).dueDate).toBeNull();
    });

    it("is cleared by an explicit null", async () => {
      // The supplied-flag branch, and the reason due_date cannot use COALESCE:
      // this is the test that fails the moment someone "simplifies" it to match
      // the priority column beside it.
      const task = await newTask({ dueDate: "2026-08-01" });
      const cleared = await updateTask(alice, task.id, { dueDate: null });
      expect(cleared!.dueDate).toBeNull();
    });

    it("leaves the date alone when the field is absent", async () => {
      // The other half of the pair above. Together they pin the three-valued
      // behaviour: absent and null must do different things, and no single
      // COALESCE can make that true.
      const task = await newTask({ dueDate: "2026-08-01" });
      const renamed = await updateTask(alice, task.id, { title: "Renamed" });
      expect(renamed!.dueDate).toBe("2026-08-01");
    });

    it("logs task.scheduled, separately from the edit beside it", async () => {
      const task = await newTask();
      await updateTask(alice, task.id, {
        title: "Renamed and dated",
        dueDate: "2026-09-09",
      });
      const actions = await actionsFor(task.id);
      expect(actions).toContain("task.scheduled");
      expect(actions).toContain("task.updated");
    });

    it("logs clearing a due date", async () => {
      // Clearing is a change like any other. Worth its own case because the
      // no-op guard compares before and after, and a naive `if (input.dueDate)`
      // would treat null as "nothing supplied" and log nothing.
      const task = await newTask({ dueDate: "2026-08-01" });
      await updateTask(alice, task.id, { dueDate: null });
      expect(await actionsFor(task.id)).toContain("task.scheduled");
    });

    it("does not log when the date does not change", async () => {
      const task = await newTask({ dueDate: "2026-08-01" });
      await updateTask(alice, task.id, { dueDate: "2026-08-01" });
      expect(await actionsFor(task.id)).not.toContain("task.scheduled");
    });
  });

  describe("one PATCH, one row per concern", () => {
    it("logs four rows when four concerns change at once", async () => {
      // The shape M2's changeset review needs: a reviewer accepting the priority
      // an agent set while rejecting its rename needs them separable, and no
      // amount of diffing one task.updated snapshot recovers that.
      const task = await newTask();
      await updateTask(alice, task.id, {
        title: "All at once",
        assignee: { type: "human", id: alice },
        priority: "high",
        dueDate: "2026-10-10",
      });
      const actions = await actionsFor(task.id);
      expect(actions).toEqual(
        expect.arrayContaining([
          "task.updated",
          "task.assigned",
          "task.prioritized",
          "task.scheduled",
        ])
      );
    });
  });
});
