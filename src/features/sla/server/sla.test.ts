import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getBoard } from "@/features/board/server/repository";
import {
  ensurePersonalWorkspace,
  getDefaultBoard,
} from "@/features/workspaces/server/repository";
import { pool, query } from "@/shared/db/client";
import { createTask, getTask } from "@/features/tasks/server/repository";
import { slaBreached, slaRemainingMins } from "../types";
import { createSlaPolicy, taskSlaStatus } from "./repository";
import { sweepSlas } from "./sweep";

describe("sla derive (pure)", () => {
  it("remaining is positive before due, negative after", () => {
    expect(slaRemainingMins(60_000, 0)).toBe(1);
    expect(slaRemainingMins(0, 120_000)).toBe(-2);
  });
  it("breached when stamped or now past due", () => {
    expect(slaBreached(null, 100, 50)).toBe(false);
    expect(slaBreached(null, 100, 150)).toBe(true);
    expect(slaBreached("2020-01-01", 100, 50)).toBe(true);
  });
});

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

describe("sla sweep (db)", () => {
  let alice: string;
  let boardId: number;
  let col1: number;

  beforeAll(async () => {
    alice = await createUser("sla-alice");
    await ensurePersonalWorkspace(alice, "SlaAlice");
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

  it("starts a timer for a matching task, then breaches + escalates it", async () => {
    const task = await createTask(alice, {
      columnId: col1,
      title: "urgent bug",
      priority: "urgent",
    });
    await createSlaPolicy(alice, boardId, {
      name: "Urgent within 60m",
      appliesWhen: { field: "priority", op: "eq", value: "urgent" },
      targetMins: 60,
      actionOnBreach: [{ type: "comment", body: "SLA breached" }],
    });

    // First sweep starts a timer (due in the future — not breached).
    await sweepSlas();
    let status = await taskSlaStatus(alice, task.id);
    expect(status).toHaveLength(1);
    expect(status[0].breached).toBe(false);
    expect(status[0].remainingMins).toBeGreaterThan(0);

    // Force the timer overdue, then sweep breaches it and runs its action.
    await query(
      `UPDATE task_sla SET due_at = now() - interval '1 minute' WHERE task_id = $1`,
      [task.id]
    );
    await sweepSlas();
    status = await taskSlaStatus(alice, task.id);
    expect(status[0].breached).toBe(true);
    expect(status[0].breachedAt).not.toBeNull();

    // The breach comment landed (add_label with 0 is a no-op set; comment runs).
    const commentCount = await query<{ n: string }>(
      `SELECT count(*) AS n FROM comment WHERE task_id = $1`,
      [task.id]
    );
    expect(Number(commentCount[0].n)).toBeGreaterThanOrEqual(1);

    // A second sweep does not re-breach (breached_at already set).
    const before = Number(
      (await query<{ n: string }>(`SELECT count(*) AS n FROM comment WHERE task_id = $1`, [task.id]))[0].n
    );
    await sweepSlas();
    const after = Number(
      (await query<{ n: string }>(`SELECT count(*) AS n FROM comment WHERE task_id = $1`, [task.id]))[0].n
    );
    expect(after).toBe(before);
    void getTask;
  });
});
