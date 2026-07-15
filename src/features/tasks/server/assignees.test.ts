import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { listRawActivityForTask } from "@/features/activity/server/repository";
import { getBoard } from "@/features/board/server/repository";
import { AuthzError } from "@/features/workspaces/server/authz";
import { removeMember } from "@/features/workspaces/server/members";
import {
  addMember,
  ensurePersonalWorkspace,
  getDefaultBoard,
} from "@/features/workspaces/server/repository";
import { pool, query, queryOne } from "@/shared/db/client";
import { createTask, getTask, updateTask } from "./repository";

/**
 * Against a real Postgres, for the same reason the activity log's tests are:
 * what is being asserted here is mostly what the *database* does when a row it
 * points at disappears — ON DELETE SET NULL rather than CASCADE, and the
 * membership invariant that no constraint can express. A mocked client would
 * agree with every one of these and prove none of them.
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

describe("assignees", () => {
  let alice: string;
  let bob: string;
  let stranger: string;
  let workspaceId: string;
  let todoId: number;

  beforeAll(async () => {
    alice = await createUser("asg-alice");
    bob = await createUser("asg-bob");
    stranger = await createUser("asg-stranger");

    workspaceId = (await ensurePersonalWorkspace(alice, "AsgAlice")).id;
    await addMember(alice, workspaceId, bob, "member");
    // Deliberately never added to alice's workspace: a real user, a real id,
    // and not assignable here. That gap is the whole tenancy question.
    await ensurePersonalWorkspace(stranger, "AsgStranger");

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

  describe("who may hold a task", () => {
    it("assigns a task to a member of the workspace", async () => {
      const task = await newTask();
      const updated = await updateTask(alice, task.id, { assigneeId: bob });
      expect(updated!.assigneeId).toBe(bob);
    });

    it("assigns at creation time", async () => {
      const task = await newTask({ assigneeId: bob });
      expect(task.assigneeId).toBe(bob);
    });

    it("refuses to assign a task to someone outside the workspace", async () => {
      // The foreign key would happily accept this id — it names a real user.
      // Only the membership check stands between a board and a stranger's face
      // appearing on it.
      const task = await newTask();
      await expect(
        updateTask(alice, task.id, { assigneeId: stranger })
      ).rejects.toThrow(AuthzError);
    });

    it("reports an outsider as not_found, never forbidden", async () => {
      // Same answer as a user id that does not exist at all. Splitting the two
      // would turn the id space into an oracle for who has an account.
      const task = await newTask();
      await expect(
        updateTask(alice, task.id, { assigneeId: stranger })
      ).rejects.toMatchObject({ kind: "not_found" });
      await expect(
        updateTask(alice, task.id, { assigneeId: "no-such-user" })
      ).rejects.toMatchObject({ kind: "not_found" });
    });

    it("leaves the task untouched when the assignee is rejected", async () => {
      // The check runs inside the transaction, so a bad assignee rolls back the
      // title that rode along with it rather than half-applying the PATCH.
      const task = await newTask({ title: "Original" });
      await expect(
        updateTask(alice, task.id, { title: "Renamed", assigneeId: stranger })
      ).rejects.toThrow(AuthzError);

      expect((await getTask(alice, task.id))!.title).toBe("Original");
    });

    it("refuses to create a task assigned to an outsider", async () => {
      await expect(newTask({ assigneeId: stranger })).rejects.toThrow(AuthzError);
    });
  });

  describe("absent is not null", () => {
    it("unassigns when explicitly given null", async () => {
      const task = await newTask({ assigneeId: bob });
      const updated = await updateTask(alice, task.id, { assigneeId: null });
      expect(updated!.assigneeId).toBeNull();
    });

    it("leaves the assignee alone when the key is absent", async () => {
      // The trap the COALESCE idiom sets: it reads null as "not supplied", so
      // an unassign and a title-only edit look identical to it. These two tests
      // fail together the moment assignee_id goes back through COALESCE.
      const task = await newTask({ assigneeId: bob });
      const updated = await updateTask(alice, task.id, { title: "Renamed" });
      expect(updated!.assigneeId).toBe(bob);
    });
  });

  describe("assignment is its own event", () => {
    it("logs task.assigned, not task.updated", async () => {
      const task = await newTask();
      await updateTask(alice, task.id, { assigneeId: bob });

      const [entry] = await listRawActivityForTask(task.id);
      expect(entry.action).toBe("task.assigned");
      expect(entry.before).toMatchObject({ assigneeId: null });
      expect(entry.after).toMatchObject({ assigneeId: bob });
    });

    it("logs two rows when one edit changes details and assignee", async () => {
      // Two things happened, so two rows — each separately invertible by undo
      // at M2, which is the point of not folding them together.
      const task = await newTask({ title: "Before" });
      await updateTask(alice, task.id, { title: "After", assigneeId: bob });

      const actions = (await listRawActivityForTask(task.id)).map((e) => e.action);
      expect(actions).toEqual(
        expect.arrayContaining(["task.assigned", "task.updated"])
      );
      expect(actions).toHaveLength(3); // + task.created
    });

    it("does not log an assignment that changed nothing", async () => {
      const task = await newTask({ assigneeId: bob });
      await updateTask(alice, task.id, { assigneeId: bob });

      const actions = (await listRawActivityForTask(task.id)).map((e) => e.action);
      expect(actions).toEqual(["task.created"]);
    });

    it("attributes an assignment to whoever made it, not to the assignee", async () => {
      const task = await newTask();
      await updateTask(alice, task.id, { assigneeId: bob });

      const [entry] = await listRawActivityForTask(task.id);
      expect(entry.actorId).toBe(alice);
    });
  });

  describe("the invariant survives membership changes", () => {
    it("clears assignments when a member is removed", async () => {
      const carol = await createUser("asg-carol");
      await addMember(alice, workspaceId, carol, "member");
      const task = await newTask({ assigneeId: carol });

      await removeMember(alice, workspaceId, carol);

      // Otherwise carol's face stays on a card in a workspace she can no longer
      // see, and the "assignee is a member" invariant is true only of rows
      // written after the fact.
      expect((await getTask(alice, task.id))!.assigneeId).toBeNull();
    });

    it("logs each unassignment a removal causes", async () => {
      const dave = await createUser("asg-dave");
      await addMember(alice, workspaceId, dave, "member");
      const task = await newTask({ assigneeId: dave });

      await removeMember(alice, workspaceId, dave);

      const [entry] = await listRawActivityForTask(task.id);
      expect(entry.action).toBe("task.assigned");
      expect(entry.before).toMatchObject({ assigneeId: dave });
      expect(entry.after).toMatchObject({ assigneeId: null });
      // Attributed to the admin who removed them — they are the actor, not dave.
      expect(entry.actorId).toBe(alice);
    });

    it("clears assignments when a member leaves of their own accord", async () => {
      const erin = await createUser("asg-erin");
      await addMember(alice, workspaceId, erin, "member");
      const task = await newTask({ assigneeId: erin });

      await removeMember(erin, workspaceId, erin);

      expect((await getTask(alice, task.id))!.assigneeId).toBeNull();
    });

    it("keeps other people's assignments when one member leaves", async () => {
      const frank = await createUser("asg-frank");
      await addMember(alice, workspaceId, frank, "member");
      const theirs = await newTask({ assigneeId: frank });
      const bobs = await newTask({ assigneeId: bob });

      await removeMember(alice, workspaceId, frank);

      expect((await getTask(alice, theirs.id))!.assigneeId).toBeNull();
      expect((await getTask(alice, bobs.id))!.assigneeId).toBe(bob);
    });
  });

  describe("deleting a person does not delete their work", () => {
    it("unassigns the task rather than cascading it away", async () => {
      // The single reason assignee_id is ON DELETE SET NULL and not CASCADE:
      // CASCADE would turn "remove a departing employee" into "destroy the
      // tasks assigned to them", silently and irreversibly.
      const ghost = await createUser("asg-ghost");
      await addMember(alice, workspaceId, ghost, "member");
      const task = await newTask({ assigneeId: ghost, title: "Survivor" });

      await query(`DELETE FROM "user" WHERE id = $1`, [ghost]);

      const survivor = await queryOne<{ title: string; assigneeId: string | null }>(
        `SELECT title, assignee_id AS "assigneeId" FROM task WHERE id = $1`,
        [task.id]
      );
      expect(survivor).toMatchObject({ title: "Survivor", assigneeId: null });
    });
  });
});
