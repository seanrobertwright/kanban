import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { addDependency } from "@/features/dependencies/server/repository";
import { createTask, moveTask } from "@/features/tasks/server/repository";
import {
  ensurePersonalWorkspace,
  getDefaultBoard,
} from "@/features/workspaces/server/repository";
import { pool, query } from "@/shared/db/client";
import { getBoardRisks, getTaskRisk } from "./analytics";
import { getBoard, setBoardDoneColumn } from "./repository";

/**
 * Delivery risk as a read of its own (4.2). The scoring is pure and already
 * tested in `lib/risk.test.ts`; what is worth a database is everything the pure
 * function cannot see — that the facts it scores are the board's real facts, and
 * that a caller who cannot read the board cannot read its risk either.
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

/** A date well in the past, so "overdue" is not a timezone argument. */
const LONG_PAST = "2020-01-01";

describe("board risk reads", () => {
  let alice: string;
  let boardId: number;
  let todoId: number;
  let doneId: number;
  let overdue: number;
  let clean: number;
  let blocker: number;

  beforeAll(async () => {
    alice = await createUser("risk-alice");
    await ensurePersonalWorkspace(alice, "RiskAlice");
    boardId = (await getDefaultBoard(alice))!.id;
    const cols = (await getBoard(alice, boardId))!.columns;
    todoId = cols[0].id;
    doneId = cols[cols.length - 1].id;
    await setBoardDoneColumn(alice, boardId, doneId);

    overdue = (await createTask(alice, {
      columnId: todoId,
      title: "Late and blocked",
      dueDate: LONG_PAST,
    })).id;
    blocker = (await createTask(alice, { columnId: todoId, title: "The blocker" })).id;
    await addDependency(alice, overdue, blocker);
    clean = (await createTask(alice, { columnId: todoId, title: "Nothing wrong" })).id;
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

  it("scores the board's real facts, with the reasons that produced them", async () => {
    const risks = await getBoardRisks(alice, boardId);
    const hit = risks.find((r) => r.taskId === overdue)!;
    expect(hit).toBeTruthy();
    expect(hit.score).toBeGreaterThan(0);
    expect(hit.reasons.some((r) => r.includes("overdue"))).toBe(true);
    // The dependency was written through the repository, so the count the
    // scorer sees is the edge a human would see on the card.
    expect(hit.reasons.some((r) => r.includes("blocked by 1"))).toBe(true);
  });

  it("says nothing about a task with no signals", async () => {
    const risks = await getBoardRisks(alice, boardId);
    expect(risks.some((r) => r.taskId === clean)).toBe(false);
    expect(await getTaskRisk(alice, clean)).toBeNull();
  });

  it("answers for one task without being told its board", async () => {
    const risk = (await getTaskRisk(alice, overdue))!;
    expect(risk.taskId).toBe(overdue);
    expect(risk.level).toBe("high");
  });

  it("drops a task once it reaches the done column", async () => {
    const shipped = (await createTask(alice, {
      columnId: todoId,
      title: "Late but shipped",
      dueDate: LONG_PAST,
    })).id;
    expect(await getTaskRisk(alice, shipped)).not.toBeNull();

    await moveTask(alice, shipped, { columnId: doneId, position: 0 });
    // Risk is about delivery, and this one delivered — the scorer drops done
    // work rather than reporting a permanent overdue signal on it.
    expect(await getTaskRisk(alice, shipped)).toBeNull();
    expect((await getBoardRisks(alice, boardId)).some((r) => r.taskId === shipped)).toBe(false);
  });

  it("refuses a caller who cannot read the board", async () => {
    const bob = await createUser("risk-bob");
    await ensurePersonalWorkspace(bob, "RiskBob");
    await expect(getBoardRisks(bob, boardId)).rejects.toThrow();
    await expect(getTaskRisk(bob, overdue)).rejects.toThrow();
  });
});
