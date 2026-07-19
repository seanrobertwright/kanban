import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createAgent } from "@/features/agents/server/admin";
import { getBoard } from "@/features/board/server/repository";
import {
  ensurePersonalWorkspace,
  getDefaultBoard,
} from "@/features/workspaces/server/repository";
import { pool, query } from "@/shared/db/client";
import { handleBulkTasks } from "./handlers";
import { createTask, getTask } from "./repository";

/**
 * Through the handler with a real agent key rather than against the repository,
 * because the bulk endpoint IS the logic: the validation, the loop over
 * per-task mutations, and the partial-failure report all live there. An
 * external agent is the principal (the gotcha the handoff records: a native
 * one would fire the Anthropic loop).
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

function bulkRequest(body: unknown, token: string): Request {
  return new Request("http://test/api/tasks/bulk", {
    method: "POST",
    headers: { "content-type": "application/json", "x-agent-key": token },
    body: JSON.stringify(body),
  });
}

describe("bulk task edit", () => {
  let alice: string;
  let token: string;
  let boardId: number;
  let todoId: number;
  let doingId: number;
  let a: number;
  let b: number;

  beforeAll(async () => {
    alice = await createUser("bulk-alice");
    const ws = await ensurePersonalWorkspace(alice, "BulkAlice");
    const board = (await getDefaultBoard(alice))!;
    boardId = board.id;
    const cols = (await getBoard(alice, boardId))!.columns;
    todoId = cols[0].id;
    doingId = cols[1].id;

    const minted = await createAgent(alice, ws.id, {
      name: "Bulk Bot",
      role: "member",
      kind: "external",
    });
    token = minted.token!;

    a = (await createTask(alice, { columnId: todoId, title: "Bulk A" })).id;
    b = (await createTask(alice, { columnId: todoId, title: "Bulk B" })).id;
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

  it("moves and prioritizes many tasks in one request, logging each", async () => {
    const res = await handleBulkTasks(
      bulkRequest({ ids: [a, b], columnId: doingId, priority: "high" }, token)
    );
    expect(res.status).toBe(200);
    const result = (await res.json()) as { updated: number; failed: unknown[] };
    expect(result.updated).toBe(2);
    expect(result.failed).toHaveLength(0);

    for (const id of [a, b]) {
      const task = (await getTask(alice, id))!;
      expect(task.columnId).toBe(doingId);
      expect(task.priority).toBe("high");
      // Each task carries its own history — one moved and one prioritized row,
      // never a "bulk" summary.
      const { rows } = await pool.query(
        `SELECT action FROM activity_log WHERE task_id = $1 ORDER BY id`,
        [id]
      );
      const actions = rows.map((r) => r.action);
      expect(actions).toContain("task.moved");
      expect(actions).toContain("task.prioritized");
    }
  });

  it("reports a missing task as a partial failure, not a request failure", async () => {
    const res = await handleBulkTasks(
      bulkRequest({ ids: [a, 999999999], priority: "low" }, token)
    );
    expect(res.status).toBe(200);
    const result = (await res.json()) as {
      updated: number;
      failed: { id: number }[];
    };
    expect(result.updated).toBe(1);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].id).toBe(999999999);
  });

  it("refuses delete combined with edits, and deletes cleanly alone", async () => {
    const refused = await handleBulkTasks(
      bulkRequest({ ids: [a], delete: true, priority: "low" }, token)
    );
    expect(refused.status).toBe(400);

    const res = await handleBulkTasks(
      bulkRequest({ ids: [a, b], delete: true }, token)
    );
    expect(res.status).toBe(200);
    // Gone means not resolvable at all: requireTaskRole answers not_found for
    // a deleted id, which surfaces as a throw rather than undefined.
    await expect(getTask(alice, a)).rejects.toThrow("Task not found");
    await expect(getTask(alice, b)).rejects.toThrow("Task not found");
  });
});
