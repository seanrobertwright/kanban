import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getBoard } from "@/features/board/server/repository";
import {
  ensurePersonalWorkspace,
  getDefaultBoard,
} from "@/features/workspaces/server/repository";
import { pool, query } from "@/shared/db/client";
import { createTask, getTask } from "@/features/tasks/server/repository";
import { createAutomationRule, listAutomationRuns } from "./repository";
import { tickScheduledAutomations } from "./scheduler";

/**
 * Recurring automation rules (047, rock 1.4): a due schedule.tick rule scans the
 * board and applies its actions to matching tasks, records a run, and advances
 * its next_run_at so it does not re-fire on the same tick.
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

describe("scheduled automations (db)", () => {
  let alice: string;
  let boardId: number;
  let col1: number;

  beforeAll(async () => {
    alice = await createUser("sched-alice");
    await ensurePersonalWorkspace(alice, "SchedAlice");
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

  it("fires a due rule against matching tasks and advances the schedule", async () => {
    const target = await createTask(alice, {
      columnId: col1,
      title: "escalate me",
      priority: "low",
    });
    const other = await createTask(alice, {
      columnId: col1,
      title: "leave me",
      priority: "high",
    });

    const rule = await createAutomationRule(alice, boardId, {
      name: "Escalate low-priority daily",
      trigger: { event: "schedule.tick", every: "daily" },
      conditions: { field: "priority", op: "eq", value: "low" },
      actions: [{ type: "set_field", field: "priority", value: "urgent" }],
    });

    // Created due (next_run_at = now()); tick it.
    const fired = await tickScheduledAutomations();
    expect(fired).toBeGreaterThanOrEqual(1);

    // Only the matching task changed.
    expect((await getTask(alice, target.id))!.priority).toBe("urgent");
    expect((await getTask(alice, other.id))!.priority).toBe("high");

    // A run was logged and the schedule advanced (no longer due now).
    const runs = await listAutomationRuns(alice, rule.id);
    expect(runs.some((r) => r.status === "matched")).toBe(true);
    const nextDue = await query<{ due: boolean }>(
      `SELECT next_run_at > now() AS due FROM automation_rule WHERE id = $1`,
      [rule.id]
    );
    expect(nextDue[0].due).toBe(true);

    // A second immediate tick does not re-fire this rule.
    const before = (await listAutomationRuns(alice, rule.id)).length;
    await tickScheduledAutomations();
    expect((await listAutomationRuns(alice, rule.id)).length).toBe(before);
  });
});
