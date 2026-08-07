import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getBoard } from "@/features/board/server/repository";
import {
  ensurePersonalWorkspace,
  getDefaultBoard,
} from "@/features/workspaces/server/repository";
import { createTask } from "@/features/tasks/server/repository";
import { createComment, listCommentsForTask } from "@/features/comments/server/repository";
import {
  addDependency,
  getDependencies,
  removeDependency,
} from "@/features/dependencies/server/repository";
import { createIdea, promoteIdea } from "@/features/discovery/server/repository";
import {
  createChecklistItem,
  updateChecklistItem,
} from "@/features/checklists/server/repository";
import {
  createField,
  setTaskFieldValues,
} from "@/features/custom-fields/server/repository";
import type { Principal } from "@/features/auth/server/principal";
import { pool, query, queryOne } from "@/shared/db/client";
import { externalAgentAction } from "./gate";
import {
  getLatestRunForTask,
  listHeldRuns,
  reviewChangeset,
  revertAction,
} from "./review";

/**
 * §7.1's promise — "an agent is subject to the same approval policy a human's
 * automation would be" — for Door 2, the external HTTP door, across the whole
 * board rather than the tasks slice alone.
 *
 * Tested at the seam the handlers call (externalAgentAction) rather than through
 * HTTP, for the reason agent-api.test.ts gives: the routes are a thin wire from
 * getPrincipalFromRequest to these calls, and this is where the tiering lives.
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

describe("Door 2 approval gate", () => {
  let owner: string;
  let workspaceId: string;
  let boardId: number;
  let todo: number;
  let agent: Extract<Principal, { kind: "agent" }>;
  let taskId: number;
  let otherTaskId: number;

  beforeAll(async () => {
    owner = await createUser("d2-owner");
    await ensurePersonalWorkspace(owner, "D2");
    boardId = (await getDefaultBoard(owner))!.id;
    const board = (await getBoard(owner, boardId))!;
    todo = board.columns[0].id;
    workspaceId = (await queryOne<{ w: string }>(
      `SELECT workspace_id AS w FROM board WHERE id = $1`,
      [boardId]
    ))!.w;

    const agentId = randomUUID();
    await query(
      `INSERT INTO agent (id, workspace_id, name, role, kind, token_hash)
       VALUES ($1, $2, 'D2 Bot', 'member', 'external', $3)`,
      [agentId, workspaceId, `hash-${agentId}`]
    );
    agent = { kind: "agent", agentId, workspaceId };

    taskId = (await createTask(owner, { columnId: todo, title: "Gated" })).id;
    otherTaskId = (await createTask(owner, { columnId: todo, title: "Blocker" })).id;
  });

  afterAll(async () => {
    await pool.end();
  });

  async function setPolicy(policy: Record<string, string>) {
    await query(`UPDATE agent SET approval_policy = $2 WHERE id = $1`, [
      agent.agentId,
      JSON.stringify(policy),
    ]);
  }

  it("records an auto-tier comment, which Door 2 previously did not", async () => {
    await setPolicy({});
    const outcome = await externalAgentAction(agent, {
      tool: "comment_on_task",
      input: { taskId, body: "on it" },
      taskId,
      execute: () => createComment(agent, { taskId, body: "on it" }),
    });

    expect(outcome.kind).toBe("done");
    // Auto means it really happened…
    const comments = await listCommentsForTask(owner, taskId);
    expect(comments.some((c) => c.body === "on it")).toBe(true);
    // …and now leaves the audit row a native run has always left, which is what
    // the run panel reads and what an undo would replay from.
    const action = await queryOne<{ tier: string }>(
      `SELECT a.tier FROM agent_action a
         JOIN agent_run r ON r.id = a.run_id
        WHERE r.agent_id = $1 AND a.tool = 'comment_on_task'`,
      [agent.agentId]
    );
    expect(action?.tier).toBe("auto");
  });

  it("obeys a block policy on a tool the gate never used to reach", async () => {
    await setPolicy({ comment_on_task: "block" });
    const outcome = await externalAgentAction(agent, {
      tool: "comment_on_task",
      input: { taskId, body: "should not appear" },
      taskId,
      execute: () => createComment(agent, { taskId, body: "should not appear" }),
    });

    expect(outcome).toEqual({ kind: "blocked", tool: "comment_on_task" });
    const comments = await listCommentsForTask(owner, taskId);
    expect(comments.some((c) => c.body === "should not appear")).toBe(false);
  });

  it("holds a comment for review when policy raises its tier", async () => {
    await setPolicy({ comment_on_task: "changeset" });
    const outcome = await externalAgentAction(agent, {
      tool: "comment_on_task",
      input: { taskId, body: "held words" },
      taskId,
      execute: () => createComment(agent, { taskId, body: "held words" }),
    });

    expect(outcome.kind).toBe("held");
    // Held means NOT applied — the point of the tier, and the thing an ungated
    // handler could never honour.
    let comments = await listCommentsForTask(owner, taskId);
    expect(comments.some((c) => c.body === "held words")).toBe(false);

    // And a raised tier must still be a tier a human can complete. An auto tool
    // with no apply case would be held forever, which turns "review this" into
    // "this silently does nothing" — worse than either tier on its own.
    const held = outcome as { changesetId: string };
    const ids = (
      await query<{ id: string }>(
        `SELECT id FROM agent_action WHERE changeset_id = $1`,
        [held.changesetId]
      )
    ).map((a) => a.id);
    await reviewChangeset(owner, held.changesetId, ids);
    comments = await listCommentsForTask(owner, taskId);
    expect(comments.some((c) => c.body === "held words")).toBe(true);
  });

  it("treats removing a blocker as auto, not as the unknown-tool fallback", async () => {
    await setPolicy({});
    await addDependency(owner, taskId, otherTaskId);
    const outcome = await externalAgentAction(agent, {
      tool: "unflag_blocker",
      input: { taskId, dependsOnId: otherTaskId },
      taskId,
      execute: () => removeDependency(agent, taskId, otherTaskId),
    });

    // An unnamed tool falls through tierFor to 'changeset', which would have held
    // the removal while its twin flag_blocker ran free.
    expect(outcome.kind).toBe("done");
    const deps = await getDependencies(owner, taskId);
    expect(deps.dependencies.some((d) => d.id === otherTaskId)).toBe(false);
  });

  it("holds promoting an idea — it creates a task, so it is decomposition", async () => {
    await setPolicy({});
    const idea = await createIdea(owner, boardId, { title: "Ship the thing" });
    const outcome = await externalAgentAction(agent, {
      tool: "promote_idea",
      input: { ideaId: idea.id },
      taskId: null,
      execute: () => promoteIdea(agent, idea.id),
    });

    expect(outcome.kind).toBe("held");
    const before = await queryOne<{ promoted: number | null }>(
      `SELECT promoted_task_id AS promoted FROM idea WHERE id = $1`,
      [idea.id]
    );
    expect(before?.promoted).toBeNull();

    // And the held proposal is one a human can actually accept: review.ts knows
    // how to apply it. A tool held with no apply case is a proposal that can
    // never become a change.
    const held = outcome as { changesetId: string };
    await reviewChangeset(
      owner,
      held.changesetId,
      (
        await query<{ id: string }>(
          `SELECT id FROM agent_action WHERE changeset_id = $1`,
          [held.changesetId]
        )
      ).map((a) => a.id)
    );
    const after = await queryOne<{ promoted: number | null }>(
      `SELECT promoted_task_id AS promoted FROM idea WHERE id = $1`,
      [idea.id]
    );
    expect(after?.promoted).not.toBeNull();
  });

  it("lets an agent do the checklist and custom-field work the door advertises", async () => {
    await setPolicy({});
    // Both tools are in mcp/README's list and both used to 401 for an agent
    // token, because their handlers resolved a session. Reaching the repository
    // as an agent principal is what makes them real.
    const item = await createChecklistItem(agent, taskId, { content: "step" });
    expect(item.content).toBe("step");
    const checked = await updateChecklistItem(agent, item.id, { done: true });
    expect(checked.done).toBe(true);

    const field = await createField(owner, boardId, {
      name: "Severity",
      type: "text",
    });
    const values = await setTaskFieldValues(agent, taskId, [
      { fieldId: field.id, value: "high" },
    ]);
    expect(values.find((v) => v.id === field.id)?.value).toBe("high");
    // And the history says the AGENT answered it, not the user who minted its
    // token — the actor was hard-coded human before.
    const logged = await queryOne<{ actorType: string; actorId: string }>(
      `SELECT actor_type AS "actorType", actor_id AS "actorId" FROM activity_log
        WHERE task_id = $1 AND action = 'customField.valued'
        ORDER BY created_at DESC LIMIT 1`,
      [taskId]
    );
    expect(logged).toMatchObject({ actorType: "agent", actorId: agent.agentId });
  });

  it("refuses to let an agent approve its own changeset", async () => {
    await setPolicy({});
    const outcome = await externalAgentAction(agent, {
      tool: "move_task",
      input: { id: taskId, columnId: todo, position: 0 },
      taskId,
      execute: async () => undefined,
    });
    const held = outcome as { changesetId: string };

    // The 202 says "a human will accept or reject it". Without this rule the
    // agent could accept it itself and the changeset tier would mean nothing.
    await expect(reviewChangeset(agent, held.changesetId, [])).rejects.toThrow(
      /Only a person/
    );
  });

  it("keeps a held run visible to the task dialog past a newer auto run", async () => {
    await setPolicy({});
    const heldTask = (
      await createTask(owner, { columnId: todo, title: "Shadowed" })
    ).id;
    const held = (await externalAgentAction(agent, {
      tool: "move_task",
      input: { id: heldTask, columnId: todo, position: 0 },
      taskId: heldTask,
      execute: async () => undefined,
    })) as { changesetId: string };
    // The work_task prompt's step 5: the agent comments right after the hold, so
    // a NEWER run exists 50 ms later — and "latest by clock" would show it.
    await externalAgentAction(agent, {
      tool: "comment_on_task",
      input: { taskId: heldTask, body: "held one for you" },
      taskId: heldTask,
      execute: () =>
        createComment(agent, { taskId: heldTask, body: "held one for you" }),
    });

    const detail = await getLatestRunForTask(owner, heldTask);
    expect(detail?.changeset).toMatchObject({
      id: held.changesetId,
      status: "pending",
    });
  });

  it("lists a task-less held create in the workspace review queue", async () => {
    await setPolicy({});
    const held = (await externalAgentAction(agent, {
      tool: "create_task",
      input: { columnId: todo, title: "Proposed by an agent" },
      taskId: null,
      execute: async () => undefined,
    })) as { changesetId: string };

    // No task id, so no task dialog will ever surface it — the queue must.
    const queue = await listHeldRuns(owner, workspaceId);
    const mine = queue.find((run) => run.changeset?.id === held.changesetId);
    expect(mine).toBeDefined();
    expect(mine!.taskId).toBeNull();

    // Reviewed means resolved — and gone from the queue.
    await reviewChangeset(owner, held.changesetId, []);
    const after = await listHeldRuns(owner, workspaceId);
    expect(after.some((run) => run.changeset?.id === held.changesetId)).toBe(false);
  });

  it("refuses to let an agent undo an agent's action", async () => {
    await setPolicy({});
    const action = await queryOne<{ id: string }>(
      `SELECT a.id FROM agent_action a
         JOIN agent_run r ON r.id = a.run_id
        WHERE r.agent_id = $1 AND a.tier = 'auto' LIMIT 1`,
      [agent.agentId]
    );
    await expect(revertAction(agent, action!.id)).rejects.toThrow(/Only a person/);
  });
});
