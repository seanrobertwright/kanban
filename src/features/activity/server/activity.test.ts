import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getBoard } from "@/features/board/server/repository";
import { createLabel } from "@/features/labels/server/repository";
import {
  createTask,
  deleteTask,
  moveTask,
  updateTask,
} from "@/features/tasks/server/repository";
import { AuthzError } from "@/features/workspaces/server/authz";
import {
  addMember,
  ensurePersonalWorkspace,
  getDefaultBoard,
} from "@/features/workspaces/server/repository";
import { pool, query } from "@/shared/db/client";
import { listActivityForTask, listRawActivityForTask } from "./repository";

/**
 * The M1 acceptance criterion is "every mutation writes an activity_log row with
 * actor attribution", so these run against the real database: the log's value is
 * entirely in properties Postgres enforces (the append-only trigger, the absence
 * of a foreign key that would cascade a deletion record away). A mocked client
 * would confirm all of it and prove none of it.
 */

async function createUser(label: string): Promise<string> {
  const id = `test-${label}-${randomUUID()}`;
  await query(
    `INSERT INTO "user" (id, name, email, "emailVerified")
     VALUES ($1, $2, $3, true)`,
    [id, `Test ${label}`, `${id}@example.test`]
  );
  return id;
}

describe("activity log", () => {
  let alice: string;
  let bob: string;
  let boardId: number;
  let workspaceId: string;
  let todoId: number;
  let doneId: number;

  beforeAll(async () => {
    alice = await createUser("act-alice");
    bob = await createUser("act-bob");
    await ensurePersonalWorkspace(alice, "ActAlice");
    await ensurePersonalWorkspace(bob, "ActBob");

    const board = (await getDefaultBoard(alice))!;
    boardId = board.id;
    workspaceId = board.workspaceId;
    const columns = (await getBoard(alice, boardId))!.columns;
    todoId = columns[0].id;
    doneId = columns[2].id;
  });

  afterAll(async () => {
    const ids = [alice, bob];
    await query(
      `DELETE FROM workspace w
        WHERE EXISTS (SELECT 1 FROM workspace_member m
                       WHERE m.workspace_id = w.id AND m.user_id = ANY($1))`,
      [ids]
    );
    await query(`DELETE FROM "user" WHERE id = ANY($1)`, [ids]);
    await pool.end();
  });

  describe("every mutation is recorded", () => {
    it("logs task.created with an after snapshot and no before", async () => {
      const task = await createTask(alice, {
        columnId: todoId,
        title: "Logged create",
      });
      const [entry] = await listRawActivityForTask(task.id);

      expect(entry.action).toBe("task.created");
      expect(entry.before).toBeNull();
      expect(entry.after).toMatchObject({
        title: "Logged create",
        columnId: todoId,
      });
    });

    it("logs task.updated with both sides of the change", async () => {
      const task = await createTask(alice, { columnId: todoId, title: "Before" });
      await updateTask(alice, task.id, { title: "After" });

      const [entry] = await listRawActivityForTask(task.id);
      expect(entry.action).toBe("task.updated");
      expect(entry.before).toMatchObject({ title: "Before" });
      expect(entry.after).toMatchObject({ title: "After" });
    });

    it("logs task.moved with the column on each side", async () => {
      const task = await createTask(alice, { columnId: todoId, title: "Movable" });
      await moveTask(alice, task.id, { columnId: doneId, position: 0 });

      const [entry] = await listRawActivityForTask(task.id);
      expect(entry.action).toBe("task.moved");
      expect(entry.before).toMatchObject({ columnId: todoId });
      expect(entry.after).toMatchObject({ columnId: doneId });
    });

    it("attributes every entry to the human who acted", async () => {
      const task = await createTask(alice, { columnId: todoId, title: "Attributed" });
      const [entry] = await listRawActivityForTask(task.id);

      expect(entry.actorType).toBe("human");
      expect(entry.actorId).toBe(alice);
    });

    it("accumulates a task's history newest-first", async () => {
      const task = await createTask(alice, { columnId: todoId, title: "History" });
      await updateTask(alice, task.id, { title: "History v2" });
      await moveTask(alice, task.id, { columnId: doneId, position: 0 });

      const actions = (await listRawActivityForTask(task.id)).map((e) => e.action);
      expect(actions).toEqual(["task.moved", "task.updated", "task.created"]);
    });
  });

  describe("the log outlives what it describes", () => {
    it("keeps task.deleted after the task is gone", async () => {
      // The whole reason activity_log.task_id carries no foreign key: a CASCADE
      // here would erase the record of the deletion, which is the single row an
      // audit trail most needs to keep.
      const task = await createTask(alice, { columnId: todoId, title: "Doomed" });
      expect(await deleteTask(alice, task.id)).toBe(true);

      const entries = await listRawActivityForTask(task.id);
      expect(entries[0].action).toBe("task.deleted");
      expect(entries[0].before).toMatchObject({ title: "Doomed" });
      // And its creation is still there too.
      expect(entries.map((e) => e.action)).toContain("task.created");
    });

    it("holds enough in `before` to reconstruct a deleted task", async () => {
      // This is undo's substrate (M2): the inverse of a delete is an insert of
      // exactly this snapshot.
      //
      // toEqual, not toMatchObject, and deliberately so: it fails whenever the
      // snapshot gains a field, which is the point. Every field a task has must
      // be in here or undo silently restores an incomplete task — assigneeId
      // arrived at 004 exactly this way, priority and dueDate at 006, labels at
      // 007, parentId at 008, claimedBy at 010, type/estimate (022),
      // milestoneId (026), sprintId (028), and epicId (031) each tripped it
      // again. Ten for ten; the comment has earned its keep.
      const label = await createLabel(alice, workspaceId, { name: "recoverable" });
      const task = await createTask(alice, {
        columnId: todoId,
        title: "Recoverable",
        description: "with a body",
        priority: "high",
        type: "bug",
        estimate: 5,
        dueDate: "2026-08-01",
        labelIds: [label.id],
      });
      await deleteTask(alice, task.id);

      const [entry] = await listRawActivityForTask(task.id);
      expect(entry.before).toEqual({
        title: "Recoverable",
        description: "with a body",
        columnId: todoId,
        position: expect.any(Number),
        assignee: null,
        // Set to non-defaults above precisely so this asserts the values were
        // captured, rather than that the keys exist. A snapshot that recorded
        // 'none', null and [] for every task would pass a weaker version of this
        // test and restore the wrong task.
        priority: "high",
        type: "bug",
        estimate: 5,
        // Null, because this task aims at nothing — but present, because undo
        // of a delete must restore the aim. See TaskSnapshot.milestoneId (026).
        milestoneId: null,
        // Null (backlog), present for the same reason (028).
        sprintId: null,
        // Null (filed under no epic), present for the same reason (031).
        epicId: null,
        // Null (no start date), present for the same reason (032).
        startDate: null,
        dueDate: "2026-08-01",
        // Name included: the label is what undo needs to restore, and 007's
        // whole point is that this stays readable after the label is deleted.
        labels: [{ id: label.id, name: "recoverable" }],
        // Null, because this task is top-level — but present, because undo of a
        // subtask's deletion restores it under the parent it was a piece of, and
        // a snapshot missing this field would put the piece back on the board as
        // a card that was never there. See TaskSnapshot.parentId (008).
        parentId: null,
        // Null, because this task was never claimed — but present, because undo
        // of a delete restores the hold, and a snapshot missing this field would
        // bring a claimed task back free. See TaskSnapshot.claimedBy (010).
        claimedBy: null,
      });
    });

    it("survives the deletion of the user who acted", async () => {
      const ghost = await createUser("ghost");
      await addMember(alice, (await getDefaultBoard(alice))!.workspaceId, ghost, "member");
      const task = await createTask(ghost, { columnId: todoId, title: "By a ghost" });
      await query(`DELETE FROM "user" WHERE id = $1`, [ghost]);

      // actor_id has no FK, so the row stands. The name resolves to null rather
      // than the entry vanishing — losing history because its author left would
      // defeat the point of keeping it.
      const [raw] = await listRawActivityForTask(task.id);
      expect(raw.actorId).toBe(ghost);

      const [entry] = await listActivityForTask(alice, task.id);
      expect(entry.actorName).toBeNull();
      expect(entry.action).toBe("task.created");
    });
  });

  describe("append-only", () => {
    it("refuses to let history be rewritten", async () => {
      const task = await createTask(alice, { columnId: todoId, title: "Immutable" });
      const [entry] = await listRawActivityForTask(task.id);

      await expect(
        query(`UPDATE activity_log SET action = 'task.forged' WHERE id = $1`, [
          entry.id,
        ])
      ).rejects.toThrow(/append-only/);
    });

    it("still lets a workspace be deleted, cascading its log away", async () => {
      // The trigger blocks UPDATE only. Blocking DELETE would make tenants
      // undeletable, since workspace removal cascades through here.
      const carol = await createUser("carol");
      const ws = await ensurePersonalWorkspace(carol, "Carol");
      const column = (await getBoard(carol, (await getDefaultBoard(carol))!.id))!
        .columns[0];
      const task = await createTask(carol, { columnId: column.id, title: "Doomed" });

      await query(`DELETE FROM workspace WHERE id = $1`, [ws.id]);
      expect(await listRawActivityForTask(task.id)).toHaveLength(0);
      await query(`DELETE FROM "user" WHERE id = $1`, [carol]);
    });
  });

  describe("no-op writes are not mutations", () => {
    it("does not log an update that changed nothing", async () => {
      const task = await createTask(alice, { columnId: todoId, title: "Same" });
      await updateTask(alice, task.id, { title: "Same" });

      const actions = (await listRawActivityForTask(task.id)).map((e) => e.action);
      expect(actions).toEqual(["task.created"]);
    });

    it("does not log a move to where the task already is", async () => {
      const task = await createTask(alice, { columnId: todoId, title: "Stationary" });
      await moveTask(alice, task.id, {
        columnId: todoId,
        position: task.position,
      });

      const actions = (await listRawActivityForTask(task.id)).map((e) => e.action);
      expect(actions).toEqual(["task.created"]);
    });
  });

  describe("reading history is tenancy-scoped", () => {
    it("refuses to show another workspace's task history", async () => {
      const task = await createTask(alice, { columnId: todoId, title: "Private" });
      await expect(listActivityForTask(bob, task.id)).rejects.toThrow(AuthzError);
    });

    it("resolves the actor's name for rendering", async () => {
      const task = await createTask(alice, { columnId: todoId, title: "Named" });
      const [entry] = await listActivityForTask(alice, task.id);
      expect(entry.actorName).toBe("Test act-alice");
    });
  });
});
