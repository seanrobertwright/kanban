import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getBoard } from "@/features/board/server/repository";
import { createTask } from "@/features/tasks/server/repository";
import {
  ensurePersonalWorkspace,
  getDefaultBoard,
} from "@/features/workspaces/server/repository";
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
  let ctx: RunContext;

  /** The tool with this name, or a failure that names the missing tool rather
   *  than a confusing `undefined.run`. */
  function toolNamed(name: string) {
    const tools = buildTools(ctx, boardId, null);
    const found = tools.find((t) => t.name === name);
    if (!found) throw new Error(`Door 1 publishes no "${name}" tool`);
    return found;
  }

  const call = async (name: string, args: Record<string, unknown> = {}) =>
    JSON.parse((await toolNamed(name).run(args as never)) as string);

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
      // No changeset until a changeset-tier call needs one; these are reads.
      changesetId: null,
    };
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

  it("defaults the board to the one the run is on", async () => {
    // Every boardId-taking tool is optional-arg for the same reason Door 2's
    // are: the agent is handed a board, not asked to discover ids.
    const risks = await call("score_risk");
    expect(Array.isArray(risks)).toBe(true);
  });
});
