import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getBoard } from "@/features/board/server/repository";
import { listCommentsForTask } from "@/features/comments/server/repository";
import { createComment } from "@/features/comments/server/repository";
import { createLabel, listLabels } from "@/features/labels/server/repository";
import { createTask } from "@/features/tasks/server/repository";
import {
  ensurePersonalWorkspace,
  getDefaultBoard,
} from "@/features/workspaces/server/repository";
import type { Principal } from "@/features/auth/server/principal";
import { pool, query, queryOne } from "@/shared/db/client";
import { listAssignees } from "./roster";

/**
 * The agent-facing REST API, at the layer its auth resolves to: a `Principal` of
 * kind 'agent'. The routes just wire getPrincipalFromRequest to these calls, so
 * exercising the repository with an agent principal proves what an agent key can
 * reach — and, crucially, what it cannot (another workspace, anyone's email).
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

describe("agent REST API access", () => {
  let owner: string;
  let ws: string;
  let otherOwner: string;
  let otherWs: string;
  let agent: Extract<Principal, { kind: "agent" }>;
  let taskId: number;

  beforeAll(async () => {
    owner = await createUser("api-owner");
    await ensurePersonalWorkspace(owner, "ApiWs");
    const boardId = (await getDefaultBoard(owner))!.id;
    const board = (await getBoard(owner, boardId))!;
    ws = board.columns[0]
      ? (await queryOne<{ w: string }>(
          `SELECT workspace_id AS w FROM board WHERE id = $1`,
          [boardId]
        ))!.w
      : "";
    const todo = board.columns[0].id;

    otherOwner = await createUser("api-other");
    await ensurePersonalWorkspace(otherOwner, "OtherWs");
    otherWs = (await queryOne<{ w: string }>(
      `SELECT workspace_id AS w FROM board WHERE id = $1`,
      [(await getDefaultBoard(otherOwner))!.id]
    ))!.w;

    const agentId = randomUUID();
    await query(
      `INSERT INTO agent (id, workspace_id, name, role, kind, token_hash)
       VALUES ($1, $2, 'Ext Bot', 'member', 'external', $3)`,
      [agentId, ws, `hash-${agentId}`]
    );
    agent = { kind: "agent", agentId, workspaceId: ws };

    await createLabel(owner, ws, { name: "bug", color: "red" });
    const task = await createTask(owner, { columnId: todo, title: "A task" });
    taskId = task.id;
    await createComment(owner, { taskId, body: "first" });
  });

  afterAll(async () => {
    await query(`DELETE FROM workspace WHERE id = ANY($1)`, [[ws, otherWs]]);
    await query(`DELETE FROM "user" WHERE id = ANY($1)`, [[owner, otherOwner]]);
    await pool.end();
  });

  it("an agent key reads its workspace's labels", async () => {
    const labels = await listLabels(agent, ws);
    expect(labels.map((l) => l.name)).toContain("bug");
  });

  it("an agent key reads a task's comments", async () => {
    const comments = await listCommentsForTask(agent, taskId);
    expect(comments.map((c) => c.body)).toContain("first");
  });

  it("the assignee roster carries no email addresses", async () => {
    const { members, agents } = await listAssignees(agent, ws);
    expect(members.length).toBeGreaterThan(0);
    for (const m of members) expect("email" in m).toBe(false);
    // The agent itself appears among the assignable agents (it is a peer, 011).
    expect(agents.some((a) => a.id === agent.agentId)).toBe(true);
  });

  it("an agent cannot read another workspace's labels or roster", async () => {
    await expect(listLabels(agent, otherWs)).rejects.toThrow();
    await expect(listAssignees(agent, otherWs)).rejects.toThrow();
  });
});
