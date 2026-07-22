import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getBoard } from "@/features/board/server/repository";
import {
  ensurePersonalWorkspace,
  getDefaultBoard,
} from "@/features/workspaces/server/repository";
import { pool, query } from "@/shared/db/client";
import { createTask, getTask } from "@/features/tasks/server/repository";
import {
  boardForTriggerToken,
  createAutomationRule,
  createTrigger,
  setTriggerActive,
} from "./repository";
import { fireExternalTrigger } from "./scheduler";

/**
 * External automation connectors (049, rock 1.12): an active token resolves to
 * its board and fires the board's external.trigger rules, which scan and act. A
 * revoked token resolves to nothing.
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

describe("external triggers (db)", () => {
  let alice: string;
  let boardId: number;
  let col1: number;

  beforeAll(async () => {
    alice = await createUser("trig-alice");
    await ensurePersonalWorkspace(alice, "TrigAlice");
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

  it("an active token fires external.trigger rules; a revoked one resolves to null", async () => {
    const task = await createTask(alice, {
      columnId: col1,
      title: "driven from outside",
      priority: "low",
    });
    await createAutomationRule(alice, boardId, {
      name: "External escalate",
      trigger: { event: "external.trigger" },
      conditions: { field: "priority", op: "eq", value: "low" },
      actions: [{ type: "set_field", field: "priority", value: "urgent" }],
    });
    const trigger = await createTrigger(alice, boardId, "n8n");

    // The token resolves to the board, and firing applies the rule.
    expect(await boardForTriggerToken(boardId, trigger.token)).toBe(boardId);
    const fired = await fireExternalTrigger(boardId);
    expect(fired).toBeGreaterThanOrEqual(1);
    expect((await getTask(alice, task.id))!.priority).toBe("urgent");

    // A token minted for this board does not resolve for a different board id.
    expect(await boardForTriggerToken(boardId + 999999, trigger.token)).toBeNull();

    // Revoked → resolves to null.
    await setTriggerActive(alice, trigger.id, false);
    expect(await boardForTriggerToken(boardId, trigger.token)).toBeNull();
  });
});
