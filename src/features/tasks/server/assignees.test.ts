import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { listRawActivityForTask } from "@/features/activity/server/repository";
import { hashAgentToken } from "@/features/auth/server/agent-auth";
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
 * points at disappears — ON DELETE SET NULL rather than CASCADE, the exactly-one
 * CHECK (011), and the membership invariant that no constraint can express. A
 * mocked client would agree with every one of these and prove none of them.
 *
 * An assignee is an Actor now (011): a person OR an agent. The human cases are
 * 004's, carried forward through the reshape; the agent cases are what 011 adds,
 * and they are tested beside their human twins deliberately — the whole point is
 * that one code path treats the two identically.
 */

const createdUsers: string[] = [];

/** {type:'human', id} — the assignee shape, spelled short for readability. */
const human = (id: string) => ({ type: "human" as const, id });
const agentRef = (id: string) => ({ type: "agent" as const, id });

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

async function createAgent(
  workspaceId: string,
  name: string,
  role: "member" | "viewer" = "member"
): Promise<string> {
  const id = randomUUID();
  await query(
    `INSERT INTO agent (id, workspace_id, name, role, kind, token_hash)
     VALUES ($1, $2, $3, $4, 'external', $5)`,
    [id, workspaceId, name, role, hashAgentToken(randomUUID())]
  );
  return id;
}

describe("assignees", () => {
  let alice: string;
  let bob: string;
  let stranger: string;
  let workspaceId: string;
  let todoId: number;
  let triage: string; // an agent of alice's workspace
  let strangerAgent: string; // an agent of a different workspace

  beforeAll(async () => {
    alice = await createUser("asg-alice");
    bob = await createUser("asg-bob");
    stranger = await createUser("asg-stranger");

    workspaceId = (await ensurePersonalWorkspace(alice, "AsgAlice")).id;
    await addMember(alice, workspaceId, bob, "member");
    // Deliberately never added to alice's workspace: a real user, a real id,
    // and not assignable here. That gap is the whole tenancy question.
    const strangerWs = (await ensurePersonalWorkspace(stranger, "AsgStranger")).id;

    triage = await createAgent(workspaceId, "Triage Bot");
    // The agent equivalent of `stranger`: a real agent, a real id, belonging to
    // another workspace and so not assignable here.
    strangerAgent = await createAgent(strangerWs, "Outsider Bot");

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
      const updated = await updateTask(alice, task.id, { assignee: human(bob) });
      expect(updated!.assignee).toEqual(human(bob));
    });

    it("assigns a task to an agent of the workspace — the wedge in one field", async () => {
      const task = await newTask();
      const updated = await updateTask(alice, task.id, {
        assignee: agentRef(triage),
      });
      expect(updated!.assignee).toEqual(agentRef(triage));
    });

    it("assigns at creation time, human or agent", async () => {
      expect((await newTask({ assignee: human(bob) })).assignee).toEqual(
        human(bob)
      );
      expect((await newTask({ assignee: agentRef(triage) })).assignee).toEqual(
        agentRef(triage)
      );
    });

    it("refuses to assign a task to a person outside the workspace", async () => {
      // The foreign key would happily accept this id — it names a real user.
      // Only the membership check stands between a board and a stranger's face
      // appearing on it.
      const task = await newTask();
      await expect(
        updateTask(alice, task.id, { assignee: human(stranger) })
      ).rejects.toThrow(AuthzError);
    });

    it("refuses to assign a task to an agent of another workspace", async () => {
      // 011's half of the invariant: an agent belongs to one workspace (009), so
      // an agent of someone else's is no more assignable here than a stranger is.
      const task = await newTask();
      await expect(
        updateTask(alice, task.id, { assignee: agentRef(strangerAgent) })
      ).rejects.toMatchObject({ kind: "not_found" });
    });

    it("reports an outsider as not_found, never forbidden", async () => {
      // Same answer as an id that does not exist at all. Splitting the two would
      // turn the id space into an oracle for who — human or agent — exists.
      const task = await newTask();
      await expect(
        updateTask(alice, task.id, { assignee: human(stranger) })
      ).rejects.toMatchObject({ kind: "not_found" });
      await expect(
        updateTask(alice, task.id, { assignee: human("no-such-user") })
      ).rejects.toMatchObject({ kind: "not_found" });
      await expect(
        updateTask(alice, task.id, { assignee: agentRef("no-such-agent") })
      ).rejects.toMatchObject({ kind: "not_found" });
    });

    it("leaves the task untouched when the assignee is rejected", async () => {
      // The check runs inside the transaction, so a bad assignee rolls back the
      // title that rode along with it rather than half-applying the PATCH.
      const task = await newTask({ title: "Original" });
      await expect(
        updateTask(alice, task.id, {
          title: "Renamed",
          assignee: human(stranger),
        })
      ).rejects.toThrow(AuthzError);

      expect((await getTask(alice, task.id))!.title).toBe("Original");
    });

    it("refuses to create a task assigned to an outsider", async () => {
      await expect(newTask({ assignee: human(stranger) })).rejects.toThrow(
        AuthzError
      );
    });
  });

  describe("exactly one assignee", () => {
    it("clears the human when reassigning to an agent, and back", async () => {
      // The task_one_assignee CHECK (011) forbids both columns being set at once;
      // assigneeColumns keeps it true by clearing the peer. So a person-to-agent
      // reassignment must leave assignee_id null and agent_id set — read straight
      // from the two columns, because the Actor above them cannot show a both-set
      // row that should be impossible.
      const task = await newTask({ assignee: human(bob) });

      await updateTask(alice, task.id, { assignee: agentRef(triage) });
      expect(
        await queryOne<{ assignee_id: string | null; agent_id: string | null }>(
          `SELECT assignee_id, agent_id FROM task WHERE id = $1`,
          [task.id]
        )
      ).toEqual({ assignee_id: null, agent_id: triage });

      await updateTask(alice, task.id, { assignee: human(bob) });
      expect(
        await queryOne<{ assignee_id: string | null; agent_id: string | null }>(
          `SELECT assignee_id, agent_id FROM task WHERE id = $1`,
          [task.id]
        )
      ).toEqual({ assignee_id: bob, agent_id: null });
    });
  });

  describe("absent is not null", () => {
    it("unassigns when explicitly given null", async () => {
      const task = await newTask({ assignee: human(bob) });
      const updated = await updateTask(alice, task.id, { assignee: null });
      expect(updated!.assignee).toBeNull();
    });

    it("leaves the assignee alone when the key is absent", async () => {
      // The trap the COALESCE idiom sets: it reads null as "not supplied", so an
      // unassign and a title-only edit look identical to it. These two tests fail
      // together the moment the assignee goes back through COALESCE.
      const task = await newTask({ assignee: human(bob) });
      const updated = await updateTask(alice, task.id, { title: "Renamed" });
      expect(updated!.assignee).toEqual(human(bob));
    });
  });

  describe("assignment is its own event", () => {
    it("logs task.assigned, not task.updated", async () => {
      const task = await newTask();
      await updateTask(alice, task.id, { assignee: human(bob) });

      const [entry] = await listRawActivityForTask(task.id);
      expect(entry.action).toBe("task.assigned");
      expect(entry.before).toMatchObject({ assignee: null });
      expect(entry.after).toMatchObject({ assignee: human(bob) });
    });

    it("logs the agent it went to, so M2's run-trigger is findable", async () => {
      // §8: assigning a task to an agent is what triggers a run, and the one
      // action the wedge hangs off must be findable in the log, not inferred.
      const task = await newTask();
      await updateTask(alice, task.id, { assignee: agentRef(triage) });

      const [entry] = await listRawActivityForTask(task.id);
      expect(entry.action).toBe("task.assigned");
      expect(entry.after).toMatchObject({ assignee: agentRef(triage) });
    });

    it("logs two rows when one edit changes details and assignee", async () => {
      // Two things happened, so two rows — each separately invertible by undo at
      // M2, which is the point of not folding them together.
      const task = await newTask({ title: "Before" });
      await updateTask(alice, task.id, { title: "After", assignee: human(bob) });

      const actions = (await listRawActivityForTask(task.id)).map((e) => e.action);
      expect(actions).toEqual(
        expect.arrayContaining(["task.assigned", "task.updated"])
      );
      expect(actions).toHaveLength(3); // + task.created
    });

    it("does not log an assignment that changed nothing", async () => {
      const task = await newTask({ assignee: human(bob) });
      await updateTask(alice, task.id, { assignee: human(bob) });

      const actions = (await listRawActivityForTask(task.id)).map((e) => e.action);
      expect(actions).toEqual(["task.created"]);
    });

    it("attributes an assignment to whoever made it, not to the assignee", async () => {
      const task = await newTask();
      await updateTask(alice, task.id, { assignee: human(bob) });

      const [entry] = await listRawActivityForTask(task.id);
      expect(entry.actorId).toBe(alice);
    });
  });

  describe("the invariant survives membership changes", () => {
    it("clears human assignments when a member is removed", async () => {
      const carol = await createUser("asg-carol");
      await addMember(alice, workspaceId, carol, "member");
      const task = await newTask({ assignee: human(carol) });

      await removeMember(alice, workspaceId, carol);

      // Otherwise carol's face stays on a card in a workspace she can no longer
      // see, and the "assignee is a member" invariant is true only of rows
      // written after the fact.
      expect((await getTask(alice, task.id))!.assignee).toBeNull();
    });

    it("does not disturb an agent's assignments when a human is removed", async () => {
      // unassignFromWorkspace clears assignee_id, not agent_id: an agent's
      // membership is not the departing human's to lose. The agent is still an
      // agent of this workspace, so its assignment stands.
      const heidi = await createUser("asg-heidi");
      await addMember(alice, workspaceId, heidi, "member");
      const agentTask = await newTask({ assignee: agentRef(triage) });

      await removeMember(alice, workspaceId, heidi);

      expect((await getTask(alice, agentTask.id))!.assignee).toEqual(
        agentRef(triage)
      );
    });

    it("logs each unassignment a removal causes", async () => {
      const dave = await createUser("asg-dave");
      await addMember(alice, workspaceId, dave, "member");
      const task = await newTask({ assignee: human(dave) });

      await removeMember(alice, workspaceId, dave);

      const [entry] = await listRawActivityForTask(task.id);
      expect(entry.action).toBe("task.assigned");
      expect(entry.before).toMatchObject({ assignee: human(dave) });
      expect(entry.after).toMatchObject({ assignee: null });
      // Attributed to the admin who removed them — they are the actor, not dave.
      expect(entry.actorId).toBe(alice);
    });

    it("clears assignments when a member leaves of their own accord", async () => {
      const erin = await createUser("asg-erin");
      await addMember(alice, workspaceId, erin, "member");
      const task = await newTask({ assignee: human(erin) });

      await removeMember(erin, workspaceId, erin);

      expect((await getTask(alice, task.id))!.assignee).toBeNull();
    });

    it("keeps other people's assignments when one member leaves", async () => {
      const frank = await createUser("asg-frank");
      await addMember(alice, workspaceId, frank, "member");
      const theirs = await newTask({ assignee: human(frank) });
      const bobs = await newTask({ assignee: human(bob) });

      await removeMember(alice, workspaceId, frank);

      expect((await getTask(alice, theirs.id))!.assignee).toBeNull();
      expect((await getTask(alice, bobs.id))!.assignee).toEqual(human(bob));
    });
  });

  describe("deleting the assignee does not delete their work", () => {
    it("unassigns rather than cascading when a person is deleted", async () => {
      // The single reason assignee_id is ON DELETE SET NULL and not CASCADE:
      // CASCADE would turn "remove a departing employee" into "destroy the
      // tasks assigned to them", silently and irreversibly.
      const ghost = await createUser("asg-ghost");
      await addMember(alice, workspaceId, ghost, "member");
      const task = await newTask({ assignee: human(ghost), title: "Survivor" });

      await query(`DELETE FROM "user" WHERE id = $1`, [ghost]);

      const survivor = await queryOne<{ title: string; assigneeId: string | null }>(
        `SELECT title, assignee_id AS "assigneeId" FROM task WHERE id = $1`,
        [task.id]
      );
      expect(survivor).toMatchObject({ title: "Survivor", assigneeId: null });
    });

    it("unassigns rather than cascading when an agent is deleted", async () => {
      // 011 gives agent_id the same ON DELETE SET NULL: deleting an agent frees
      // the tasks it held; it does not take them down. Same rule, agent half.
      const doomedAgent = await createAgent(workspaceId, "Doomed Bot");
      const task = await newTask({
        assignee: agentRef(doomedAgent),
        title: "Outlives its agent",
      });

      await query(`DELETE FROM agent WHERE id = $1`, [doomedAgent]);

      const survivor = await queryOne<{ title: string; agentId: string | null }>(
        `SELECT title, agent_id AS "agentId" FROM task WHERE id = $1`,
        [task.id]
      );
      expect(survivor).toMatchObject({
        title: "Outlives its agent",
        agentId: null,
      });
    });
  });
});
