import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createAgent } from "@/features/agents/server/admin";
import { getBoard, setBoardDoneColumn } from "@/features/board/server/repository";
import { createTask, moveTask, updateTask, getTask } from "@/features/tasks/server/repository";
import {
  ensurePersonalWorkspace,
  getDefaultBoard,
} from "@/features/workspaces/server/repository";
import { pool, query } from "@/shared/db/client";
import {
  completeSprint,
  createSprint,
  deleteSprint,
  getBoardSprintCapacity,
  listSprints,
  startSprint,
} from "./repository";

/**
 * Against a real Postgres because the interesting parts are database
 * invariants: the one-active partial unique index, the rollover UPDATE joined
 * through the done column, and the capacity GROUP BY that counts an agent
 * beside a human.
 */

const createdUsers: string[] = [];
const human = (id: string) => ({ type: "human" as const, id });

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

describe("sprints", () => {
  let alice: string;
  let ws: string;
  let boardId: number;
  let todoId: number;
  let doneId: number;
  let agentId: string;

  beforeAll(async () => {
    alice = await createUser("sp-alice");
    const workspace = await ensurePersonalWorkspace(alice, "SpAlice");
    ws = workspace.id;
    boardId = (await getDefaultBoard(alice))!.id;
    const cols = (await getBoard(alice, boardId))!.columns;
    todoId = cols[0].id;
    doneId = cols[cols.length - 1].id;
    await setBoardDoneColumn(alice, boardId, doneId);
    // An external agent, so assigning does not fire the Anthropic loop.
    const minted = await createAgent(alice, ws, {
      name: "Sprint Bot",
      role: "member",
      kind: "external",
    });
    agentId = minted.agent.id;
  });

  afterAll(async () => {
    await query(`DELETE FROM workspace WHERE id = $1`, [ws]);
    await query(`DELETE FROM "user" WHERE id = ANY($1)`, [createdUsers]);
    await pool.end();
  });

  it("enforces one active sprint per board", async () => {
    const a = await createSprint(alice, boardId, { name: "S-A" }, human(alice));
    const b = await createSprint(alice, boardId, { name: "S-B" }, human(alice));

    const started = await startSprint(alice, a.id, human(alice));
    expect(started!.status).toBe("active");
    expect(started!.startDate).not.toBeNull(); // defaulted to today

    await expect(startSprint(alice, b.id, human(alice))).rejects.toThrow(
      /already has an active sprint/
    );

    // Clean up so later tests start from no active sprint.
    await completeSprint(alice, a.id, null, human(alice));
  });

  it("counts human and agent capacity side by side (the PRD payoff)", async () => {
    const sprint = await createSprint(alice, boardId, { name: "Cap" }, human(alice));
    await createTask(alice, {
      columnId: todoId,
      title: "Human work",
      estimate: 5,
      assignee: { type: "human", id: alice },
      sprintId: sprint.id,
    });
    await createTask(alice, {
      columnId: todoId,
      title: "Agent work",
      estimate: 3,
      assignee: { type: "agent", id: agentId },
      sprintId: sprint.id,
    });

    const capacity = await getBoardSprintCapacity(alice, boardId);
    const rows = capacity.filter((r) => r.sprintId === sprint.id);
    const humanRow = rows.find((r) => r.assigneeType === "human")!;
    const agentRow = rows.find((r) => r.assigneeType === "agent")!;
    expect(humanRow.points).toBe(5);
    expect(agentRow.points).toBe(3);
    expect(agentRow.assigneeId).toBe(agentId);
  });

  it("rolls unfinished tasks forward on complete, freezing the done ones", async () => {
    const current = await createSprint(alice, boardId, { name: "Current" }, human(alice));
    const next = await createSprint(alice, boardId, { name: "Next" }, human(alice));
    await startSprint(alice, current.id, human(alice));

    const finished = await createTask(alice, {
      columnId: todoId,
      title: "Finished",
      estimate: 2,
      sprintId: current.id,
    });
    const unfinished = await createTask(alice, {
      columnId: todoId,
      title: "Unfinished",
      estimate: 8,
      sprintId: current.id,
    });
    await moveTask(alice, finished.id, { columnId: doneId, position: 0 });

    await completeSprint(alice, current.id, next.id, human(alice));

    // The finished task stays in the completed sprint (frozen scope); the
    // unfinished one moved to the next sprint.
    expect((await getTask(alice, finished.id))!.sprintId).toBe(current.id);
    expect((await getTask(alice, unfinished.id))!.sprintId).toBe(next.id);

    const listed = await listSprints(alice, boardId);
    const done = listed.find((s) => s.id === current.id)!;
    expect(done.status).toBe("completed");
    // Velocity's substrate: the completed sprint's done points.
    expect(done.donePoints).toBe(2);
  });

  it("refuses scheduling into a completed or cross-board sprint", async () => {
    const done = (await listSprints(alice, boardId)).find(
      (s) => s.status === "completed"
    )!;
    const task = await createTask(alice, { columnId: todoId, title: "Late" });
    await expect(
      updateTask(alice, task.id, { sprintId: done.id })
    ).rejects.toThrow(/completed/);

    // Cross-board: bob's sprint on bob's board.
    const bob = await createUser("sp-bob");
    await ensurePersonalWorkspace(bob, "SpBob");
    const bobBoard = (await getDefaultBoard(bob))!.id;
    const bobSprint = await createSprint(bob, bobBoard, { name: "Bob" }, human(bob));
    await expect(
      updateTask(alice, task.id, { sprintId: bobSprint.id })
    ).rejects.toThrow(/not on this board/);
  });

  it("only walks the lifecycle forwards", async () => {
    const sprint = await createSprint(alice, boardId, { name: "One-way" }, human(alice));

    // planning cannot be completed — completing is what freezes scope, and a
    // sprint that never ran has no scope to freeze.
    await expect(
      completeSprint(alice, sprint.id, null, human(alice))
    ).rejects.toThrow(/active/);

    const started = await startSprint(alice, sprint.id, human(alice));
    expect(started!.status).toBe("active");
    // An active sprint cannot be started again — the second start would be the
    // one that quietly re-anchors the burndown window.
    await expect(startSprint(alice, sprint.id, human(alice))).rejects.toThrow(
      /planning/
    );

    const completed = await completeSprint(alice, sprint.id, null, human(alice));
    expect(completed!.status).toBe("completed");
    // Terminal: restarting a completed sprint would make velocity drift, since
    // its frozen scope is what every later average is computed from.
    await expect(startSprint(alice, sprint.id, human(alice))).rejects.toThrow(
      /planning/
    );
    await expect(
      completeSprint(alice, sprint.id, null, human(alice))
    ).rejects.toThrow(/active/);
  });

  it("anchors the dates the lifecycle implies", async () => {
    const sprint = await createSprint(alice, boardId, { name: "Dateless" }, human(alice));
    expect(sprint.startDate).toBeNull();

    const started = await startSprint(alice, sprint.id, human(alice));
    // Burndown needs a window anchor, so starting without a date takes today
    // rather than leaving a sprint that is running from nowhere.
    expect(started!.startDate).not.toBeNull();
    expect(started!.endDate).toBeNull();

    const completed = await completeSprint(alice, sprint.id, null, human(alice));
    expect(completed!.endDate).not.toBeNull();
  });

  it("falls back to the backlog when the rollover target is not a place work can go", async () => {
    const current = await createSprint(alice, boardId, { name: "Rolling" }, human(alice));
    await startSprint(alice, current.id, human(alice));
    const task = await createTask(alice, {
      columnId: todoId,
      title: "Homeless",
      sprintId: current.id,
    });

    // Another board's planning sprint is a valid id and an invalid destination.
    // Refusing the whole completion would strand the sprint mid-lifecycle, so
    // the work falls to the backlog instead — visible, and re-plannable.
    const bob = await createUser("sp-roll-bob");
    await ensurePersonalWorkspace(bob, "SpRollBob");
    const bobBoard = (await getDefaultBoard(bob))!.id;
    const bobSprint = await createSprint(bob, bobBoard, { name: "Bob's" }, human(bob));

    await completeSprint(alice, current.id, bobSprint.id, human(alice));
    expect((await getTask(alice, task.id))!.sprintId).toBeNull();
  });

  it("deleting a sprint un-schedules its work rather than taking it along", async () => {
    const sprint = await createSprint(alice, boardId, { name: "Doomed" }, human(alice));
    const task = await createTask(alice, {
      columnId: todoId,
      title: "Survivor",
      sprintId: sprint.id,
    });

    expect(await deleteSprint(alice, sprint.id, human(alice))).toBe(true);
    const survivor = await getTask(alice, task.id);
    expect(survivor).toBeDefined();
    expect(survivor!.sprintId).toBeNull();

    const logged = await query<{ n: string }>(
      `SELECT count(*) AS n FROM activity_log
        WHERE board_id = $1 AND action = 'sprint.deleted'`,
      [boardId]
    );
    expect(Number(logged[0].n)).toBeGreaterThan(0);

    // A sprint id nobody owns is not_found, the same answer another board's
    // sprint gets — the id space is not an oracle.
    await expect(
      deleteSprint(alice, 2_000_000_000, human(alice))
    ).rejects.toThrow(/not found/i);
  });
});
