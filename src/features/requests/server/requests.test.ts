import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getBoard } from "@/features/board/server/repository";
import {
  ensurePersonalWorkspace,
  getDefaultBoard,
} from "@/features/workspaces/server/repository";
import { pool, query } from "@/shared/db/client";
import { createTask } from "@/features/tasks/server/repository";
import { createForm, submitForm } from "@/features/forms/server/repository";
import { listRequests, triageRequest } from "./repository";

/**
 * Request management (052, rock 1.8): a form submission becomes a request in the
 * queue (stamped request_meta, showing its source + requester); an ordinary task
 * does not appear.
 */

const createdUsers: string[] = [];
async function createUser(label: string, name: string): Promise<string> {
  const id = `test-${label}-${randomUUID()}`;
  await query(
    `INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, true)`,
    [id, name, `${id}@example.test`]
  );
  createdUsers.push(id);
  return id;
}

describe("requests queue (db)", () => {
  let alice: string;
  let boardId: number;
  let col1: number;
  let col2: number;

  beforeAll(async () => {
    alice = await createUser("req-alice", "Rick Requester");
    await ensurePersonalWorkspace(alice, "ReqAlice");
    boardId = (await getDefaultBoard(alice))!.id;
    const columns = (await getBoard(alice, boardId))!.columns;
    col1 = columns[0].id;
    col2 = columns[1].id;
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

  it("lists a form submission as a request, not an ordinary task", async () => {
    // An ordinary task — should NOT appear in the queue.
    await createTask(alice, { columnId: col1, title: "just a task" });

    const form = await createForm(alice, boardId, {
      name: "Access request",
      targetColumnId: col1,
      fields: [{ label: "What do you need?", type: "text", required: true }],
    });
    await submitForm(alice, form.id, { answers: ["VPN access"] });

    const requests = await listRequests(alice, boardId);
    expect(requests).toHaveLength(1);
    expect(requests[0].title).toBe("VPN access");
    expect(requests[0].source).toBe("Access request");
    expect(requests[0].requesterName).toBe("Rick Requester");
    // Untriaged: the queue's "open" is the absence of a verdict, not a stored
    // 'open' state, so a request that predates triage reads open for free.
    expect(requests[0].triage).toBeNull();
  });

  it("accepts a request: routes it, stamps the verdict, logs it once", async () => {
    const form = await createForm(alice, boardId, {
      name: "Laptop request",
      targetColumnId: col1,
      fields: [{ label: "What do you need?", type: "text", required: true }],
    });
    const task = await submitForm(alice, form.id, { answers: ["A new laptop"] });

    const accepted = await triageRequest(alice, boardId, task.id, {
      action: "accept",
      columnId: col2,
      assignee: { type: "human", id: alice },
      priority: "high",
    });

    expect(accepted.triage?.state).toBe("accepted");
    expect(accepted.triage?.actorId).toBe(alice);
    expect(accepted.columnId).toBe(col2);
    expect(accepted.assignee).toEqual({ type: "human", id: alice });
    expect(accepted.priority).toBe("high");

    const logged = await query<{ action: string; after: { state: string } }>(
      `SELECT action, after FROM activity_log
        WHERE task_id = $1 AND action LIKE 'request.%'`,
      [task.id]
    );
    expect(logged).toHaveLength(1);
    expect(logged[0].action).toBe("request.accepted");
    expect(logged[0].after.state).toBe("accepted");
  });

  it("declines with a reason, and reopening clears the verdict", async () => {
    const form = await createForm(alice, boardId, {
      name: "Budget request",
      targetColumnId: col1,
      fields: [{ label: "What do you need?", type: "text", required: true }],
    });
    const task = await submitForm(alice, form.id, { answers: ["A yacht"] });

    const declined = await triageRequest(alice, boardId, task.id, {
      action: "decline",
      reason: "Out of scope this quarter",
    });
    expect(declined.triage?.state).toBe("declined");
    expect(declined.triage?.reason).toBe("Out of scope this quarter");

    const reopened = await triageRequest(alice, boardId, task.id, {
      action: "reopen",
    });
    expect(reopened.triage).toBeNull();

    // The stamp that makes the task a request must survive both writes — the
    // whole point of editing request_meta's `triage` key rather than the object.
    expect(reopened.source).toBe("Budget request");
    expect(reopened.requesterName).toBe("Rick Requester");
  });

  it("refuses to triage a task that is not a request, or one on another board", async () => {
    const plain = await createTask(alice, { columnId: col1, title: "not intake" });
    await expect(
      triageRequest(alice, boardId, plain.id, { action: "accept" })
    ).rejects.toThrow(/not a request/);

    const form = await createForm(alice, boardId, {
      name: "Wrong-door request",
      targetColumnId: col1,
      fields: [{ label: "What do you need?", type: "text", required: true }],
    });
    const task = await submitForm(alice, form.id, { answers: ["A door"] });
    await expect(
      triageRequest(alice, boardId + 10_000, task.id, { action: "accept" })
    ).rejects.toThrow(/not on this board/);
  });
});
