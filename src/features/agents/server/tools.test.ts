import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { addDependency } from "@/features/dependencies/server/repository";
import { getBoard } from "@/features/board/server/repository";
import { createTask, getTask } from "@/features/tasks/server/repository";
import {
  ensurePersonalWorkspace,
  getDefaultBoard,
} from "@/features/workspaces/server/repository";
import {
  createKeyResult,
  createObjective,
} from "@/features/objectives/server/repository";
import { pool, query } from "@/shared/db/client";
import { createAgent } from "./admin";
import type { RunContext } from "./gate";
import { buildTools } from "./tools";

/**
 * Door 1's tool layer, driven directly rather than through the model — the run
 * function is the door, and the Tool Runner in between contributes nothing this
 * needs to prove.
 *
 * What it does prove is the thing the review filed: capability that exists as a
 * library is not capability an agent has. A tool nobody registered is invisible
 * no matter how well the code underneath it works, so these tests call the tools
 * by name and assert the answers actually carry the new work.
 */

const createdUsers: string[] = [];

async function createUser(label: string): Promise<string> {
  const id = `test-${label}-${randomUUID()}`;
  await query(
    `INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, true)`,
    [id, `Test ${label}`, `${id}@example.test`]
  );
  createdUsers.push(id);
  return id;
}

describe("door 1 tools", () => {
  let alice: string;
  let boardId: number;
  let todoId: number;
  let overdue: number;
  let objectiveId: number;
  let keyResultId: number;
  let ctx: RunContext;

  /** The tool with this name, or a failure that names the missing tool rather
   *  than a confusing `undefined.run`. */
  function toolNamed(name: string) {
    const tools = buildTools(ctx, boardId, null);
    const found = tools.find((t) => t.name === name);
    if (!found) throw new Error(`Door 1 publishes no "${name}" tool`);
    return found;
  }

  /** A read tool's answer, parsed. */
  const call = async (name: string, args: Record<string, unknown> = {}) =>
    JSON.parse((await callRaw(name, args)) as string);

  /** A mutating tool's answer, which is prose for the model, not JSON. */
  const callRaw = async (name: string, args: Record<string, unknown> = {}) =>
    (await toolNamed(name).run(args as never)) as string;

  beforeAll(async () => {
    alice = await createUser("tools-alice");
    const ws = await ensurePersonalWorkspace(alice, "ToolsAlice");
    boardId = (await getDefaultBoard(alice))!.id;
    todoId = (await getBoard(alice, boardId))!.columns[0].id;
    overdue = (await createTask(alice, {
      columnId: todoId,
      title: "Late work",
      dueDate: "2020-01-01",
    })).id;

    const minted = await createAgent(alice, ws.id, {
      name: "Tool Bot",
      role: "member",
      kind: "external",
    });
    ctx = {
      runId: randomUUID(),
      principal: { kind: "agent", agentId: minted.agent.id, workspaceId: ws.id },
      policy: {},
      // No changeset until a changeset-tier call needs one — the gate creates it
      // lazily, so a run of pure reads never mints one.
      changesetId: null,
    };
    // A real run row: every gated call records an agent_action against it.
    await query(
      `INSERT INTO agent_run (id, agent_id, task_id, workspace_id, status)
       VALUES ($1, $2, NULL, $3, 'running')`,
      [ctx.runId, minted.agent.id, ws.id]
    );

    objectiveId = (
      await createObjective(alice, boardId, { name: "Reduce toil" }, { type: "human", id: alice })
    ).id;
    keyResultId = (
      await createKeyResult(alice, objectiveId, {
        title: "Manual steps",
        targetValue: 0,
        startValue: 10,
        currentValue: 10,
      })
    ).keyResults[0].id;
  });

  afterAll(async () => {
    await query(
      `DELETE FROM workspace w WHERE EXISTS (
         SELECT 1 FROM workspace_member m WHERE m.workspace_id = w.id AND m.user_id = ANY($1))`,
      [createdUsers]
    );
    await query(`DELETE FROM "user" WHERE id = ANY($1)`, [createdUsers]);
    await pool.end();
  });

  it("scores delivery risk on demand", async () => {
    const risks = await call("score_risk", { boardId });
    const hit = risks.find((r: { taskId: number }) => r.taskId === overdue);
    expect(hit).toBeTruthy();
    expect(hit.reasons.some((r: string) => r.includes("overdue"))).toBe(true);
  });

  it("carries risk on the board read, unasked", async () => {
    const board = await call("list_board", { boardId });
    expect(board.columns.length).toBeGreaterThan(0);
    expect(board.risks.some((r: { taskId: number }) => r.taskId === overdue)).toBe(true);
  });

  it("carries risk on a single task read", async () => {
    const task = await call("get_task", { id: overdue });
    expect(task.id).toBe(overdue);
    expect(task.risk.level).toBeTruthy();
  });

  it("proposes a schedule without writing one", async () => {
    const first = (await createTask(alice, {
      columnId: todoId,
      title: "Schedule me first",
      estimate: 3,
    })).id;
    const second = (await createTask(alice, {
      columnId: todoId,
      title: "Schedule me second",
      estimate: 3,
    })).id;
    await addDependency(alice, second, first);

    const proposals = await call("propose_schedule", { boardId });
    const one = proposals.find((r: { taskId: number }) => r.taskId === first);
    const two = proposals.find((r: { taskId: number }) => r.taskId === second);
    expect(one).toBeTruthy();
    // The blocked task cannot start before its blocker's due date — the whole
    // point of a dependency-ordered pass.
    expect(two.startDate >= one.dueDate).toBe(true);

    // And nothing landed. This is the tool's contract, not an implementation
    // detail: the agent plans, a human applies.
    expect((await getTask(alice, first))!.dueDate).toBeNull();
    expect((await getTask(alice, second))!.startDate).toBeNull();
  });

  it("publishes no tool that applies a whole schedule", () => {
    const names = buildTools(ctx, boardId, null).map((t) => t.name);
    expect(names).toContain("propose_schedule");
    expect(names.some((n) => /apply_schedule|set_schedule/.test(n))).toBe(false);
  });

  it("reads a board's objectives and their key results", async () => {
    const objectives = await call("list_objectives", { boardId });
    const found = objectives.find((o: { id: number }) => o.id === objectiveId);
    expect(found.keyResults[0].id).toBe(keyResultId);
  });

  it("scores a key result immediately — a measurement is auto tier", async () => {
    const answer = await callRaw("score_key_result", { id: keyResultId, currentValue: 5 });
    expect(answer).toMatch(/Set key result/);

    const kr = (await call("list_objectives", { boardId }))
      .flatMap((o: { keyResults: { id: number; currentValue: number }[] }) => o.keyResults)
      .find((k: { id: number }) => k.id === keyResultId);
    expect(kr.currentValue).toBe(5);
  });

  it("holds a new objective for review — structure is changeset tier", async () => {
    const answer = await callRaw("set_objective", { boardId, name: "Agent's objective" });
    expect(answer).toMatch(/Proposed for review/);

    const names = (await call("list_objectives", { boardId })).map(
      (o: { name: string }) => o.name
    );
    expect(names).not.toContain("Agent's objective");
  });

  it("defaults the board to the one the run is on", async () => {
    // Every boardId-taking tool is optional-arg for the same reason Door 2's
    // are: the agent is handed a board, not asked to discover ids.
    const risks = await call("score_risk");
    expect(Array.isArray(risks)).toBe(true);
  });
});
