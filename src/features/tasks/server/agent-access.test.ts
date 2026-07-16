import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  listActivityForTask,
  listRawActivityForTask,
} from "@/features/activity/server/repository";
import {
  AGENT_KEY_HEADER,
  getAgentByToken,
  getPrincipalFromRequest,
  hashAgentToken,
} from "@/features/auth/server/agent-auth";
import type { Principal } from "@/features/auth/server/principal";
import { getBoard } from "@/features/board/server/repository";
import {
  createComment,
  listCommentsForTask,
} from "@/features/comments/server/repository";
import {
  ensurePersonalWorkspace,
  getDefaultBoard,
} from "@/features/workspaces/server/repository";
import { pool, query } from "@/shared/db/client";
import { createTask, getTask, moveTask, updateTask } from "./repository";

/**
 * The agent principal, end to end, against a real Postgres — because the whole
 * point is that an agent is subject to the *same* RBAC and audit a human is (§7.1),
 * and that is a claim about what the database enforces: the role join swaps
 * workspace_member for agent, the actor lands in activity_log with actor_type
 * 'agent', and a cross-workspace token resolves to no row. A mock would agree with
 * every one of those and prove none.
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
  token: string;
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
  return { id, token, principal: { kind: "agent", agentId: id, workspaceId } };
}

describe("agent access", () => {
  let alice: string;
  let workspaceId: string;
  let todoId: number;
  let doingId: number;
  let bobTaskId: number;
  let agent: TestAgent;

  beforeAll(async () => {
    alice = await createUser("agt-alice");
    await ensurePersonalWorkspace(alice, "AgtAlice");
    const board = (await getDefaultBoard(alice))!;
    workspaceId = board.workspaceId;
    const cols = (await getBoard(alice, board.id))!.columns;
    todoId = cols[0].id;
    doingId = cols[1].id;

    agent = await createAgent(workspaceId, "Triage Bot", "member");

    // A stranger's task, in a workspace this agent has no row in.
    const bob = await createUser("agt-bob");
    await ensurePersonalWorkspace(bob, "AgtBob");
    const bobBoard = (await getDefaultBoard(bob))!;
    const bobTodo = (await getBoard(bob, bobBoard.id))!.columns[0].id;
    bobTaskId = (await createTask(bob, { columnId: bobTodo, title: "Bob's" })).id;
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

  describe("acts as itself", () => {
    it("creates a task attributed to the agent, not to a user", async () => {
      // The one hardcode this whole change removes: the actor is the principal,
      // so the audit row carries actor_type 'agent' and the agent's own id — the
      // schema was built actor-typed at 003 precisely so this row is expressible.
      const task = await createTask(agent.principal, {
        columnId: todoId,
        title: "Triage this bug",
      });

      const [created] = await listRawActivityForTask(task.id);
      expect(created.action).toBe("task.created");
      expect(created.actorType).toBe("agent");
      expect(created.actorId).toBe(agent.id);
    });

    it("edits and moves a task, each logged under the agent", async () => {
      const task = await createTask(agent.principal, {
        columnId: todoId,
        title: "Work me",
      });
      await updateTask(agent.principal, task.id, { priority: "high" });
      const moved = await moveTask(agent.principal, task.id, {
        columnId: doingId,
        position: 0,
      });
      expect(moved!.columnId).toBe(doingId);

      const actors = (await listRawActivityForTask(task.id)).map((e) => ({
        action: e.action,
        actorType: e.actorType,
        actorId: e.actorId,
      }));
      expect(actors).toEqual(
        expect.arrayContaining([
          { action: "task.moved", actorType: "agent", actorId: agent.id },
          { action: "task.prioritized", actorType: "agent", actorId: agent.id },
        ])
      );
    });

    it("comments under its own name, resolved for the reader", async () => {
      // §7.1's comment_on_task. author_type is 'agent' (the actor_type enum, 005),
      // and the read joins `agent` so the thread shows the agent's name rather
      // than "An agent".
      const task = await createTask(agent.principal, {
        columnId: todoId,
        title: "Needs a note",
      });
      await createComment(agent.principal, {
        taskId: task.id,
        body: "Triaged: this is a duplicate of #12.",
      });

      const [comment] = await listCommentsForTask(alice, task.id);
      expect(comment.authorType).toBe("agent");
      expect(comment.authorId).toBe(agent.id);
      expect(comment.authorName).toBe("Triage Bot");
    });

    it("shows the agent's name in a task's history", async () => {
      const task = await createTask(agent.principal, {
        columnId: todoId,
        title: "For the feed",
      });
      const [entry] = await listActivityForTask(alice, task.id);
      expect(entry.actorType).toBe("agent");
      expect(entry.actorName).toBe("Triage Bot");
    });
  });

  describe("is bound by the same RBAC a human is", () => {
    it("cannot touch a task in another workspace — reported as not_found", async () => {
      // The agent's role join is scoped to its own workspace_id, so a stranger's
      // task resolves to no row: not_found, never forbidden, so the token cannot
      // be used to probe which ids exist elsewhere (authz.ts's anti-enumeration
      // rule, inherited rather than restated).
      await expect(
        getTask(agent.principal, bobTaskId)
      ).rejects.toMatchObject({ kind: "not_found" });
    });

    it("a viewer agent may comment but not create or move", async () => {
      // 004's line, holding for agents: a viewer can be handed work and report on
      // it (comment is 'viewer'), but moving a card is a board mutation ('member').
      const viewer = await createAgent(workspaceId, "Read Only", "viewer");
      const task = await createTask(alice, { columnId: todoId, title: "Guarded" });

      await expect(
        createTask(viewer.principal, { columnId: todoId, title: "nope" })
      ).rejects.toMatchObject({ kind: "forbidden" });
      await expect(
        moveTask(viewer.principal, task.id, { columnId: doingId, position: 0 })
      ).rejects.toMatchObject({ kind: "forbidden" });

      const comment = await createComment(viewer.principal, {
        taskId: task.id,
        body: "A viewer's question.",
      });
      expect(comment.authorId).toBe(viewer.id);
    });
  });

  describe("the credential", () => {
    it("resolves a valid token to its agent principal, and rejects a bad one", async () => {
      await expect(getAgentByToken(agent.token)).resolves.toMatchObject({
        kind: "agent",
        agentId: agent.id,
        workspaceId,
      });
      await expect(getAgentByToken("kbn_not_a_real_token")).resolves.toBeNull();
    });

    it("resolves a request carrying the agent-key header", async () => {
      // No cookie, so getPrincipalFromRequest falls through to the agent header —
      // the strict-superset behaviour that keeps the human path untouched.
      const request = new Request("http://localhost/api/tasks", {
        headers: { [AGENT_KEY_HEADER]: agent.token },
      });
      await expect(getPrincipalFromRequest(request)).resolves.toMatchObject({
        kind: "agent",
        agentId: agent.id,
      });
    });
  });
});
