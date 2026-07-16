import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { listRawActivityForTask } from "@/features/activity/server/repository";
import { hashAgentToken } from "@/features/auth/server/agent-auth";
import type { Principal } from "@/features/auth/server/principal";
import { getBoard } from "@/features/board/server/repository";
import { removeMember } from "@/features/workspaces/server/members";
import {
  addMember,
  ensurePersonalWorkspace,
  getDefaultBoard,
} from "@/features/workspaces/server/repository";
import { pool, query } from "@/shared/db/client";
import { claimTask, createTask, getTask, releaseTask } from "./repository";

/**
 * Claiming, against a real Postgres — because the one property that matters is
 * one only the database provides. "Two agents cannot claim the same task"
 * (acceptance #4) is a claim about a row lock (FOR UPDATE) serializing two
 * concurrent transactions, and a mock would agree the second call was refused
 * while proving nothing about what happens when they actually overlap. The race
 * test below drives two real transactions at once; it is the reason this file
 * exists.
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

interface TestAgent {
  id: string;
  principal: Principal;
}

async function createAgent(
  workspaceId: string,
  name: string,
  role: "member" | "viewer" | "admin" = "member"
): Promise<TestAgent> {
  const id = randomUUID();
  const token = `kbn_test_${randomUUID()}`;
  await query(
    `INSERT INTO agent (id, workspace_id, name, role, kind, token_hash)
     VALUES ($1, $2, $3, $4, 'external', $5)`,
    [id, workspaceId, name, role, hashAgentToken(token)]
  );
  return { id, principal: { kind: "agent", agentId: id, workspaceId } };
}

describe("task claiming", () => {
  let alice: string; // workspace owner
  let bob: string; // a human member
  let workspaceId: string;
  let todoId: number;
  let agentA: TestAgent;
  let agentB: TestAgent;
  let viewerAgent: TestAgent;

  beforeAll(async () => {
    alice = await createUser("clm-alice");
    await ensurePersonalWorkspace(alice, "ClmAlice");
    const board = (await getDefaultBoard(alice))!;
    workspaceId = board.workspaceId;
    todoId = (await getBoard(alice, board.id))!.columns[0].id;

    bob = await createUser("clm-bob");
    await addMember(alice, workspaceId, bob, "member");

    agentA = await createAgent(workspaceId, "Agent A", "member");
    agentB = await createAgent(workspaceId, "Agent B", "member");
    viewerAgent = await createAgent(workspaceId, "Read Only", "viewer");
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

  const freshTask = (title = "Claimable") =>
    createTask(alice, { columnId: todoId, title });

  const claimedActions = async (taskId: number) =>
    (await listRawActivityForTask(taskId))
      .map((e) => e.action)
      .filter((a) => a === "task.claimed" || a === "task.released");

  describe("the exclusive hold", () => {
    it("refuses a second agent's claim on a held task", async () => {
      const task = await freshTask();
      await claimTask(agentA.principal, task.id);

      // Acceptance criterion #4, the plain-sequential case. Conflict, not
      // forbidden: agent B has the rank to claim, the task's state refuses it.
      await expect(
        claimTask(agentB.principal, task.id)
      ).rejects.toMatchObject({ kind: "conflict" });
    });

    it("lets the holder re-claim its own hold, logging only once", async () => {
      const task = await freshTask();
      await claimTask(agentA.principal, task.id);
      const again = await claimTask(agentA.principal, task.id);

      // Idempotent: an agent retrying after a dropped MCP connection must not be
      // told the task it holds is taken — and the retry is a no-op, so it writes
      // no second row.
      expect(again!.claimedBy).toMatchObject({ type: "agent", id: agentA.id });
      expect(await claimedActions(task.id)).toEqual(["task.claimed"]);
    });

    it("serializes two concurrent claims — exactly one wins", async () => {
      // The reason for the file. Both transactions open at once and race for the
      // same free task; FOR UPDATE in lockTask makes the second block until the
      // first commits, then read the claim and be refused. Without the lock both
      // would read a free task and both would write — the collision claiming
      // exists to prevent.
      const task = await freshTask();
      const results = await Promise.allSettled([
        claimTask(agentA.principal, task.id),
        claimTask(agentB.principal, task.id),
      ]);

      const won = results.filter((r) => r.status === "fulfilled");
      const lost = results.filter((r) => r.status === "rejected");
      expect(won).toHaveLength(1);
      expect(lost).toHaveLength(1);
      expect((lost[0] as PromiseRejectedResult).reason).toMatchObject({
        kind: "conflict",
      });

      // And the board agrees with the winner: exactly one holder, one log row.
      const holder = (await getTask(alice, task.id))!.claimedBy;
      expect(holder).not.toBeNull();
      expect(await claimedActions(task.id)).toEqual(["task.claimed"]);
    });
  });

  describe("release", () => {
    it("frees a task when its holder releases it", async () => {
      const task = await freshTask();
      await claimTask(agentA.principal, task.id);
      const released = await releaseTask(agentA.principal, task.id);

      expect(released!.claimedBy).toBeNull();
      expect((await getTask(alice, task.id))!.claimedBy).toBeNull();
      expect(await claimedActions(task.id)).toEqual([
        "task.released",
        "task.claimed",
      ]);
    });

    it("treats releasing an unclaimed task as a no-op", async () => {
      const task = await freshTask();
      const released = await releaseTask(agentA.principal, task.id);

      // Returns the task, writes nothing — an agent closing out work it never
      // formally claimed should not fail on the release.
      expect(released!.claimedBy).toBeNull();
      expect(await claimedActions(task.id)).toEqual([]);
    });

    it("lets an admin break a hold another actor left stuck", async () => {
      const task = await freshTask();
      await claimTask(agentA.principal, task.id);
      // alice is the owner (outranks admin) — the escape hatch for a crashed
      // agent that never released.
      const released = await releaseTask(alice, task.id);
      expect(released!.claimedBy).toBeNull();

      const [entry] = await listRawActivityForTask(task.id);
      expect(entry.action).toBe("task.released");
      expect(entry.actorType).toBe("human");
      expect(entry.actorId).toBe(alice);
      // The snapshot names the holder, not the actor: the two differ here, which
      // is the whole reason the holder is recorded rather than inferred.
      expect(entry.before).toMatchObject({
        claimedBy: { type: "agent", id: agentA.id },
      });
      expect(entry.after).toMatchObject({ claimedBy: null });
    });

    it("forbids a plain member from releasing another's hold", async () => {
      const task = await freshTask();
      await claimTask(agentA.principal, task.id);

      // bob is a member, not an admin — forbidden, not conflict: this one IS a
      // rank he lacks, unlike claimTask's state conflict.
      await expect(releaseTask(bob, task.id)).rejects.toMatchObject({
        kind: "forbidden",
      });
      expect((await getTask(alice, task.id))!.claimedBy).not.toBeNull();
    });
  });

  describe("bound by the same RBAC a board mutation is", () => {
    it("does not let a viewer agent claim", async () => {
      const task = await freshTask();
      // A viewer can be handed a task but not declare active work on it — 004's
      // line, holding for claiming exactly as it does for moving.
      await expect(
        claimTask(viewerAgent.principal, task.id)
      ).rejects.toMatchObject({ kind: "forbidden" });
    });
  });

  describe("logging", () => {
    it("records the holder in after on claim, in before on release", async () => {
      const task = await freshTask();
      await claimTask(agentA.principal, task.id);

      const [claimed] = await listRawActivityForTask(task.id);
      expect(claimed.action).toBe("task.claimed");
      expect(claimed.actorType).toBe("agent");
      expect(claimed.actorId).toBe(agentA.id);
      expect(claimed.before).toMatchObject({ claimedBy: null });
      expect(claimed.after).toMatchObject({
        claimedBy: { type: "agent", id: agentA.id },
      });

      await releaseTask(agentA.principal, task.id);
      const [released] = await listRawActivityForTask(task.id);
      expect(released.action).toBe("task.released");
      expect(released.before).toMatchObject({
        claimedBy: { type: "agent", id: agentA.id },
      });
      expect(released.after).toMatchObject({ claimedBy: null });
    });
  });

  describe("a claim is state, not history", () => {
    it("releases the claims a departing member held", async () => {
      const task = await freshTask();
      await claimTask(bob, task.id);
      expect((await getTask(alice, task.id))!.claimedBy).toMatchObject({
        type: "human",
        id: bob,
      });

      // Removing bob must free what he was holding, or the task is locked for
      // everyone until an admin breaks it — the assignee cleanup's rule, holding
      // for claims. The release is attributed to alice, who removed him, and
      // names bob as the prior holder.
      await removeMember(alice, workspaceId, bob);

      expect((await getTask(alice, task.id))!.claimedBy).toBeNull();
      const [entry] = await listRawActivityForTask(task.id);
      expect(entry.action).toBe("task.released");
      expect(entry.actorId).toBe(alice);
      expect(entry.before).toMatchObject({
        claimedBy: { type: "human", id: bob },
      });
    });
  });
});
