import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getBoard } from "@/features/board/server/repository";
import { createTask } from "@/features/tasks/server/repository";
import {
  ensurePersonalWorkspace,
  getDefaultBoard,
} from "@/features/workspaces/server/repository";
import { pool, query } from "@/shared/db/client";
import { getBoardBudget, setBoardBudget } from "./repository";

/**
 * The money maths are unit-tested pure; the database facts here are the spend
 * derived from the time_entry ledger × the board rate, the per-contributor
 * breakdown, and the three-valued budget update (042).
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

describe("budget", () => {
  let alice: string;
  let boardId: number;
  let todoId: number;

  beforeAll(async () => {
    alice = await createUser("budget-alice");
    await ensurePersonalWorkspace(alice, "BudgetAlice");
    boardId = (await getDefaultBoard(alice))!.id;
    todoId = (await getBoard(alice, boardId))!.columns[0].id;
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

  it("derives spend from logged time × the board rate", async () => {
    const task = await createTask(alice, { columnId: todoId, title: "Work" });
    // 120 minutes (2h) logged by alice.
    await query(
      `INSERT INTO time_entry (task_id, user_id, minutes) VALUES ($1, $2, $3)`,
      [task.id, alice, 120]
    );

    // No budget yet, rate 0 → spend 0, remaining null.
    let budget = await getBoardBudget(alice, boardId);
    expect(budget.loggedMinutes).toBe(120);
    expect(budget.spend).toBe(0);
    expect(budget.remaining).toBeNull();

    // Set a $1000 budget at $50/hr → 2h = $100 spent, $900 left.
    budget = await setBoardBudget(alice, boardId, {
      budgetAmount: 1000,
      hourlyRate: 50,
      currency: "USD",
    });
    expect(budget.spend).toBe(100);
    expect(budget.remaining).toBe(900);
    expect(budget.currency).toBe("USD");
    expect(budget.contributors).toHaveLength(1);
    expect(budget.contributors[0]).toMatchObject({ userId: alice, minutes: 120, cost: 100 });
  });

  it("clears the budget with null but keeps the rate (three-valued)", async () => {
    await setBoardBudget(alice, boardId, { budgetAmount: null });
    const budget = await getBoardBudget(alice, boardId);
    expect(budget.budgetAmount).toBeNull();
    expect(budget.remaining).toBeNull();
    // Rate survived the budget clear, so spend still computes.
    expect(budget.hourlyRate).toBe(50);
    expect(budget.spend).toBe(100);
  });
});
