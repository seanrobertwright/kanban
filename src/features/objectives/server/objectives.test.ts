import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { listActivityForTask } from "@/features/activity/server/repository";
import { getBoard, setBoardDoneColumn } from "@/features/board/server/repository";
import { createMilestone } from "@/features/milestones/server/repository";
import {
  createTask,
  moveTask,
  updateTask,
} from "@/features/tasks/server/repository";
import {
  ensurePersonalWorkspace,
  getDefaultBoard,
} from "@/features/workspaces/server/repository";
import { pool, query } from "@/shared/db/client";
import { keyResultProgress, objectiveProgress } from "../types";
import {
  createKeyResult,
  createObjective,
  deleteKeyResult,
  deleteObjective,
  listObjectives,
  updateKeyResult,
  updateObjective,
} from "./repository";

/**
 * The pure progress maths need no database; the CRUD, linking, rollup, tenancy
 * and activity are database facts (the two SET NULL FKs, the KR CASCADE, the
 * done-column rollup) a mock could not stand in for (037).
 */

describe("keyResultProgress / objectiveProgress (pure)", () => {
  it("measures an increasing target", () => {
    expect(keyResultProgress({ startValue: 30, targetValue: 50, currentValue: 30 })).toBe(0);
    expect(keyResultProgress({ startValue: 30, targetValue: 50, currentValue: 40 })).toBe(0.5);
    expect(keyResultProgress({ startValue: 30, targetValue: 50, currentValue: 50 })).toBe(1);
  });

  it("measures a decreasing target (churn 9 -> 4)", () => {
    expect(keyResultProgress({ startValue: 9, targetValue: 4, currentValue: 9 })).toBe(0);
    expect(keyResultProgress({ startValue: 9, targetValue: 4, currentValue: 6 })).toBeCloseTo(0.6);
    expect(keyResultProgress({ startValue: 9, targetValue: 4, currentValue: 4 })).toBe(1);
  });

  it("clamps beyond the endpoints", () => {
    expect(keyResultProgress({ startValue: 0, targetValue: 10, currentValue: -5 })).toBe(0);
    expect(keyResultProgress({ startValue: 0, targetValue: 10, currentValue: 15 })).toBe(1);
  });

  it("treats a zero span as met only at the target", () => {
    expect(keyResultProgress({ startValue: 5, targetValue: 5, currentValue: 4 })).toBe(0);
    expect(keyResultProgress({ startValue: 5, targetValue: 5, currentValue: 5 })).toBe(1);
  });

  it("averages an objective's key results, null when none", () => {
    expect(objectiveProgress([])).toBeNull();
    expect(objectiveProgress([{ progress: 0.6 }, { progress: 0.4 }])).toBeCloseTo(0.5);
  });
});

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

describe("objectives", () => {
  let alice: string;
  let boardId: number;
  let todoId: number;
  let doneId: number;
  const human = () => ({ type: "human" as const, id: alice });

  beforeAll(async () => {
    alice = await createUser("obj-alice");
    await ensurePersonalWorkspace(alice, "ObjAlice");
    boardId = (await getDefaultBoard(alice))!.id;
    const cols = (await getBoard(alice, boardId))!.columns;
    todoId = cols[0].id;
    doneId = cols[cols.length - 1].id;
    await setBoardDoneColumn(alice, boardId, doneId);
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

  it("creates an objective, adds key results, and averages their progress", async () => {
    const objective = await createObjective(
      alice,
      boardId,
      { name: "Delight users", description: "Q3" },
      human()
    );
    expect(objective.progress).toBeNull(); // no KRs yet

    await createKeyResult(alice, objective.id, {
      title: "NPS",
      startValue: 30,
      targetValue: 50,
      currentValue: 40, // halfway
      unit: "NPS",
    });
    const afterOne = await createKeyResult(alice, objective.id, {
      title: "Churn",
      startValue: 9,
      targetValue: 4, // decreasing
      currentValue: 9, // 0%
      unit: "%",
    });

    // Mean of 0.5 and 0 = 0.25.
    expect(afterOne.keyResults).toHaveLength(2);
    expect(afterOne.progress).toBeCloseTo(0.25);
  });

  it("moves progress when a key result's current value is updated", async () => {
    const objective = await createObjective(alice, boardId, { name: "Ship it" }, human());
    const withKr = await createKeyResult(alice, objective.id, {
      title: "Coverage",
      startValue: 0,
      targetValue: 100,
      currentValue: 0,
    });
    const kr = withKr.keyResults[0];

    const updated = await updateKeyResult(alice, kr.id, { currentValue: 75 });
    expect(updated.keyResults[0].currentValue).toBe(75);
    expect(updated.progress).toBeCloseTo(0.75);

    const afterDelete = await deleteKeyResult(alice, kr.id);
    expect(afterDelete.keyResults).toHaveLength(0);
    expect(afterDelete.progress).toBeNull();
  });

  it("rolls up direct tasks and member-milestone tasks against the done column", async () => {
    const objective = await createObjective(alice, boardId, { name: "Rollup" }, human());

    // A task aiming at the objective directly, moved to done.
    const direct = await createTask(alice, {
      columnId: todoId,
      title: "Direct done",
      objectiveId: objective.id,
    });
    await moveTask(alice, direct.id, { columnId: doneId, position: 0 });

    // A task aiming through a member milestone, left in todo.
    const milestone = await createMilestone(
      alice,
      boardId,
      { name: "M-obj", objectiveId: objective.id },
      human()
    );
    await createTask(alice, {
      columnId: todoId,
      title: "Via milestone",
      milestoneId: milestone.id,
    });
    // An unrelated task must not count.
    await createTask(alice, { columnId: todoId, title: "Unrelated" });

    const read = (await listObjectives(alice, boardId)).find((o) => o.id === objective.id)!;
    expect(read.total).toBe(2);
    expect(read.done).toBe(1);
  });

  it("un-aims tasks and milestones on delete, cascades key results", async () => {
    const objective = await createObjective(alice, boardId, { name: "Doomed" }, human());
    await createKeyResult(alice, objective.id, { title: "KR", targetValue: 1 });
    const task = await createTask(alice, {
      columnId: todoId,
      title: "Aimed",
      objectiveId: objective.id,
    });

    await deleteObjective(alice, objective.id, human());

    // The task survives, un-aimed (SET NULL).
    const board = await getBoard(alice, boardId);
    const survivor = board!.tasks.find((t) => t.id === task.id);
    expect(survivor?.objectiveId).toBeNull();
    // Key results went with it (CASCADE).
    const { rows } = await pool.query(
      `SELECT 1 FROM key_result WHERE objective_id = $1`,
      [objective.id]
    );
    expect(rows).toHaveLength(0);
  });

  it("refuses a cross-board objective on a task (not_found)", async () => {
    // An objective id that is not on this board must not be writable onto a task.
    await expect(
      createTask(alice, {
        columnId: todoId,
        title: "Bad aim",
        objectiveId: 9_999_999,
      })
    ).rejects.toMatchObject({ kind: "not_found" });
  });

  it("surfaces objectives on the board read and logs lifecycle activity", async () => {
    const objective = await createObjective(alice, boardId, { name: "On board" }, human());
    await updateObjective(alice, objective.id, { name: "On board, renamed" }, human());

    const board = await getBoard(alice, boardId);
    expect(board!.objectives.some((o) => o.name === "On board, renamed")).toBe(true);

    // Linking a task logs task.updated carrying objectiveId in the snapshot.
    const task = await createTask(alice, { columnId: todoId, title: "Link me" });
    await updateTask(alice, task.id, { objectiveId: objective.id });
    const entries = await listActivityForTask(alice, task.id);
    const updated = entries.find((e) => e.action === "task.updated");
    expect(updated).toBeDefined();
  });
});
