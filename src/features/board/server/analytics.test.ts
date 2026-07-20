import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTask, moveTask } from "@/features/tasks/server/repository";
import {
  completeSprint,
  createSprint,
  startSprint,
} from "@/features/sprints/server/repository";
import {
  ensurePersonalWorkspace,
  getDefaultBoard,
} from "@/features/workspaces/server/repository";
import { pool, query } from "@/shared/db/client";
import { getBoard, setBoardDoneColumn } from "./repository";
import { getBoardAnalytics } from "./analytics";

const human = (id: string) => ({ type: "human" as const, id });

/**
 * Against a real Postgres because the analytics ARE a fold over activity_log
 * rows the repositories write — a mocked log would test the fold against data
 * the real writers never produce.
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

describe("board analytics", () => {
  let alice: string;
  let boardId: number;
  let todoId: number;
  let doingId: number;
  let doneId: number;

  beforeAll(async () => {
    alice = await createUser("an-alice");
    await ensurePersonalWorkspace(alice, "AnAlice");
    boardId = (await getDefaultBoard(alice))!.id;
    const cols = (await getBoard(alice, boardId))!.columns;
    todoId = cols[0].id;
    doingId = cols[1].id;
    doneId = cols[cols.length - 1].id;
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

  it("without a done column: no lead/cycle/throughput, but CFD and workload", async () => {
    await createTask(alice, {
      columnId: todoId,
      title: "Flowing",
      estimate: 5,
      assignee: { type: "human", id: alice },
    });

    const analytics = await getBoardAnalytics(alice, boardId);
    expect(analytics.leadTime).toBeNull();
    expect(analytics.throughput).toBeNull();
    expect(analytics.cfd).toHaveLength(30);
    // Today's sample sees the task sitting in the first column.
    expect(analytics.cfd[29].counts[todoId]).toBe(1);
    const mine = analytics.workload.find((w) => w.assigneeId === alice)!;
    expect(mine.count).toBe(1);
    expect(mine.points).toBe(5);
  });

  it("with a done column: a completed task produces lead, cycle, and throughput", async () => {
    await setBoardDoneColumn(alice, boardId, doneId);
    const task = await createTask(alice, { columnId: todoId, title: "Ship it" });
    await moveTask(alice, task.id, { columnId: doingId, position: 0 });
    await moveTask(alice, task.id, { columnId: doneId, position: 0 });

    const analytics = await getBoardAnalytics(alice, boardId);
    expect(analytics.leadTime!.count).toBe(1);
    expect(analytics.cycleTime!.count).toBe(1);
    // Same-instant flow: both durations round to 0 days, honestly.
    expect(analytics.leadTime!.avgDays).toBe(0);
    // This week's throughput bucket counts the completion.
    const thisWeek = analytics.throughput!.at(-1)!;
    expect(thisWeek.count).toBe(1);
    // The CFD's latest sample shows it in Done.
    expect(analytics.cfd[29].counts[doneId]).toBe(1);
  });

  it("a task pulled back out of Done stops counting as completed", async () => {
    const task = await createTask(alice, { columnId: todoId, title: "Bounced" });
    await moveTask(alice, task.id, { columnId: doneId, position: 0 });
    await moveTask(alice, task.id, { columnId: todoId, position: 0 });

    const analytics = await getBoardAnalytics(alice, boardId);
    // Only "Ship it" from the previous test is complete.
    expect(analytics.leadTime!.count).toBe(1);
  });

  it("subtasks do not ride the flow", async () => {
    const parent = await createTask(alice, { columnId: todoId, title: "Whole" });
    await createTask(alice, {
      columnId: todoId,
      title: "Piece",
      parentId: parent.id,
    });

    const analytics = await getBoardAnalytics(alice, boardId);
    // CFD counts top-level tasks only: Flowing, Ship it (in done), Bounced,
    // Whole — the Piece is invisible.
    const latest = analytics.cfd[29];
    const total = Object.values(latest.counts).reduce((s, n) => s + n, 0);
    expect(total).toBe(4);
  });

  it("velocity reads a completed sprint's frozen done points", async () => {
    const sprint = await createSprint(alice, boardId, { name: "Sprint 1" }, human(alice));
    await startSprint(alice, sprint.id, human(alice));
    const done = await createTask(alice, {
      columnId: todoId,
      title: "Velocity-done",
      estimate: 5,
      sprintId: sprint.id,
    });
    await moveTask(alice, done.id, { columnId: doneId, position: 0 });
    // An unfinished task that rolls out on complete — it must not count.
    await createTask(alice, {
      columnId: todoId,
      title: "Velocity-open",
      estimate: 3,
      sprintId: sprint.id,
    });
    await completeSprint(alice, sprint.id, null, human(alice));

    const analytics = await getBoardAnalytics(alice, boardId);
    const row = analytics.velocity.find((v) => v.sprintId === sprint.id)!;
    expect(row.points).toBe(5);
  });

  it("burndown tracks remaining points in the active sprint, ignoring done and backlog", async () => {
    const sprint = await createSprint(alice, boardId, { name: "Live" }, human(alice));
    await startSprint(alice, sprint.id, human(alice));
    await createTask(alice, {
      columnId: todoId,
      title: "Burndown-open",
      estimate: 8,
      sprintId: sprint.id,
    });
    const shipped = await createTask(alice, {
      columnId: todoId,
      title: "Burndown-done",
      estimate: 2,
      sprintId: sprint.id,
    });
    await moveTask(alice, shipped.id, { columnId: doneId, position: 0 });

    const analytics = await getBoardAnalytics(alice, boardId);
    expect(analytics.burndown).not.toBeNull();
    expect(analytics.burndown!.sprintId).toBe(sprint.id);
    // Committed scope and today's remaining both see the 8-point open task; the
    // 2-point done task and every non-sprint task on the board are excluded.
    expect(analytics.burndown!.committed).toBe(8);
    const today = analytics.burndown!.days.at(-1)!;
    expect(today.remaining).toBe(8);

    // No active sprint → no burndown.
    await completeSprint(alice, sprint.id, null, human(alice));
    const after = await getBoardAnalytics(alice, boardId);
    expect(after.burndown).toBeNull();
  });
});
