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
import { listRequests } from "./repository";

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

  beforeAll(async () => {
    alice = await createUser("req-alice", "Rick Requester");
    await ensurePersonalWorkspace(alice, "ReqAlice");
    boardId = (await getDefaultBoard(alice))!.id;
    col1 = (await getBoard(alice, boardId))!.columns[0].id;
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
  });
});
