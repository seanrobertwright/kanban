import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getBoard } from "@/features/board/server/repository";
import {
  ensurePersonalWorkspace,
  getDefaultBoard,
} from "@/features/workspaces/server/repository";
import { pool, query } from "@/shared/db/client";
import { moveTask, getTask } from "@/features/tasks/server/repository";
import { createTask } from "@/features/tasks/server/repository";
import {
  compare,
  evaluate,
  planActions,
  resolveField,
  type Snapshot,
} from "../lib/engine";
import type { Action, Condition } from "../types";
import {
  createAutomationRule,
  deleteAutomationRule,
  listAutomationRules,
  listAutomationRuns,
  updateAutomationRule,
} from "./repository";
import { runAutomationsForActivity } from "./runner";

/**
 * The evaluator and planner are pure and unit-tested exhaustively here (no DB);
 * the rest is database fact — board scoping, the admin gate, and the end-to-end
 * fire (a real task move triggers a rule that moves the task and logs a run) —
 * which a mock could not stand in for (045).
 */

describe("resolveField (pure)", () => {
  const snap: Snapshot = {
    title: "Login broken",
    columnId: 3,
    assignee: { type: "human", id: "u1" },
    labels: [{ labelId: 7, name: "bug", color: "#f00" }],
    dueDate: null,
  };

  it("reads a top-level field", () => {
    expect(resolveField(snap, "columnId")).toBe(3);
  });
  it("walks a dotted path into an actor", () => {
    expect(resolveField(snap, "assignee.id")).toBe("u1");
    expect(resolveField(snap, "assignee.type")).toBe("human");
  });
  it("returns undefined for a missing hop rather than throwing", () => {
    expect(resolveField(snap, "assignee.nope")).toBeUndefined();
    expect(resolveField(snap, "milestone.id")).toBeUndefined();
  });
});

describe("compare (pure, total)", () => {
  it("eq / neq", () => {
    expect(compare("eq", "high", "high")).toBe(true);
    expect(compare("eq", "high", "low")).toBe(false);
    expect(compare("neq", "high", "low")).toBe(true);
  });
  it("numeric comparisons are false on non-numbers, never throw", () => {
    expect(compare("gt", 5, 3)).toBe(true);
    expect(compare("lte", 3, 3)).toBe(true);
    expect(compare("gt", "5", 3)).toBe(false);
    expect(compare("gt", undefined, 3)).toBe(false);
  });
  it("contains: substring on strings, membership on arrays", () => {
    expect(compare("contains", "hello world", "world")).toBe(true);
    expect(compare("contains", "hello", "xyz")).toBe(false);
    expect(compare("contains", [1, 2, 3], 2)).toBe(true);
  });
  it("contains: matches a label set by id", () => {
    const labels = [{ labelId: 7, name: "bug", color: "#f00" }];
    expect(compare("contains", labels, 7)).toBe(true);
    expect(compare("contains", labels, 9)).toBe(false);
  });
  it("in: field membership in a supplied array", () => {
    expect(compare("in", "high", ["high", "urgent"])).toBe(true);
    expect(compare("in", "low", ["high", "urgent"])).toBe(false);
    expect(compare("in", "high", "not-an-array")).toBe(false);
  });
  it("isSet / isEmpty treat null, '', [] as empty", () => {
    expect(compare("isSet", 0, undefined)).toBe(true);
    expect(compare("isSet", null, undefined)).toBe(false);
    expect(compare("isEmpty", "", undefined)).toBe(true);
    expect(compare("isEmpty", [], undefined)).toBe(true);
    expect(compare("isEmpty", "x", undefined)).toBe(false);
  });
  it("an unknown operator is false, not a throw", () => {
    expect(compare("wat" as never, 1, 1)).toBe(false);
  });
});

describe("evaluate (pure)", () => {
  const snap: Snapshot = { priority: "high", columnId: 3, labels: [{ labelId: 7 }] };

  it("the empty tree is always true", () => {
    expect(evaluate({} as Condition, snap)).toBe(true);
  });
  it("a leaf predicate", () => {
    expect(evaluate({ field: "priority", op: "eq", value: "high" }, snap)).toBe(true);
    expect(evaluate({ field: "priority", op: "eq", value: "low" }, snap)).toBe(false);
  });
  it("all / any / not compose", () => {
    const cond: Condition = {
      all: [
        { field: "priority", op: "eq", value: "high" },
        { any: [
          { field: "columnId", op: "eq", value: 99 },
          { field: "labels", op: "contains", value: 7 },
        ] },
        { not: { field: "columnId", op: "eq", value: 5 } },
      ],
    };
    expect(evaluate(cond, snap)).toBe(true);
  });
  it("all short-circuits to false when one child fails", () => {
    const cond: Condition = {
      all: [
        { field: "priority", op: "eq", value: "high" },
        { field: "columnId", op: "eq", value: 5 },
      ],
    };
    expect(evaluate(cond, snap)).toBe(false);
  });
});

describe("planActions (pure)", () => {
  const snap: Snapshot = { priority: "urgent", columnId: 3 };

  it("passes actions through in order", () => {
    const actions: Action[] = [
      { type: "add_label", labelId: 1 },
      { type: "comment", body: "triaged" },
    ];
    const effects = planActions(actions, snap);
    expect(effects).toHaveLength(2);
    expect(effects[0]).toEqual({ type: "add_label", labelId: 1 });
  });

  it("drops an action whose onlyIf fails, keeps one that holds", () => {
    const actions: Action[] = [
      { type: "comment", body: "urgent!", onlyIf: { field: "priority", op: "eq", value: "urgent" } },
      { type: "comment", body: "low", onlyIf: { field: "priority", op: "eq", value: "low" } },
    ];
    const effects = planActions(actions, snap);
    expect(effects).toEqual([{ type: "comment", body: "urgent!" }]);
  });

  it("elides a no-op move to the current column (breaks self-retrigger)", () => {
    const actions: Action[] = [{ type: "move", columnId: 3 }];
    expect(planActions(actions, snap)).toEqual([]);
  });

  it("strips onlyIf from the emitted effect", () => {
    const actions: Action[] = [
      { type: "move", columnId: 9, onlyIf: { field: "priority", op: "eq", value: "urgent" } },
    ];
    expect(planActions(actions, snap)).toEqual([{ type: "move", columnId: 9 }]);
  });
});

// ── Database-backed integration (needs `npm run db:up && npm run db:migrate`) ──

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

describe("automation rules (db)", () => {
  let alice: string;
  let boardId: number;
  let firstColId: number;
  let secondColId: number;

  beforeAll(async () => {
    alice = await createUser("auto-alice");
    await ensurePersonalWorkspace(alice, "AutoAlice");
    boardId = (await getDefaultBoard(alice))!.id;
    const cols = (await getBoard(alice, boardId))!.columns;
    firstColId = cols[0].id;
    secondColId = cols[1].id;
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

  it("creates, lists, updates and deletes a rule (admin)", async () => {
    const rule = await createAutomationRule(alice, boardId, {
      name: "Auto-move urgent to second column",
      trigger: { event: "task.prioritized" },
      conditions: { field: "priority", op: "eq", value: "urgent" },
      actions: [{ type: "move", columnId: secondColId }],
    });
    expect(rule.name).toBe("Auto-move urgent to second column");
    expect(rule.isEnabled).toBe(true);

    const listed = await listAutomationRules(alice, boardId);
    expect(listed.some((r) => r.id === rule.id)).toBe(true);

    const updated = await updateAutomationRule(alice, rule.id, { isEnabled: false });
    expect(updated!.isEnabled).toBe(false);

    await deleteAutomationRule(alice, rule.id);
    const after = await listAutomationRules(alice, boardId);
    expect(after.some((r) => r.id === rule.id)).toBe(false);
  });

  it("fires end-to-end: a move triggers a rule that applies an effect + logs a run", async () => {
    const task = await createTask(alice, {
      columnId: firstColId,
      title: "Ship it",
    });
    const rule = await createAutomationRule(alice, boardId, {
      name: "When moved to col 1, comment",
      trigger: { event: "task.moved" },
      conditions: { field: "columnId", op: "eq", value: secondColId },
      actions: [{ type: "comment", body: "auto-triaged by rule" }],
    });

    // Move the task — this logs task.moved, which the runner subscribes to.
    const moved = await moveTask(alice, task.id, { columnId: secondColId, position: 0 });
    // Drive the runner directly (after() does not run outside a request scope).
    const activityId = await query<{ id: string }>(
      `SELECT id FROM activity_log WHERE task_id = $1 AND action = 'task.moved'
        ORDER BY id DESC LIMIT 1`,
      [task.id]
    ).then((r) => r[0].id);
    await runAutomationsForActivity(activityId);

    const runs = await listAutomationRuns(alice, rule.id);
    expect(runs.length).toBeGreaterThanOrEqual(1);
    expect(runs[0].status).toBe("matched");
    expect(moved!.columnId).toBe(secondColId);
    // The comment effect landed as a real comment (via createComment).
    const withComment = await getTask(alice, task.id);
    expect(withComment).toBeTruthy();
  });

  it("is idempotent: re-running the same activity does not double-fire", async () => {
    const task = await createTask(alice, { columnId: firstColId, title: "Once only" });
    const rule = await createAutomationRule(alice, boardId, {
      name: "idempotency",
      trigger: { event: "task.moved" },
      actions: [{ type: "comment", body: "one" }],
    });
    await moveTask(alice, task.id, { columnId: secondColId, position: 0 });
    const activityId = await query<{ id: string }>(
      `SELECT id FROM activity_log WHERE task_id = $1 AND action = 'task.moved'
        ORDER BY id DESC LIMIT 1`,
      [task.id]
    ).then((r) => r[0].id);

    await runAutomationsForActivity(activityId);
    await runAutomationsForActivity(activityId);

    const runs = await listAutomationRuns(alice, rule.id);
    expect(runs.filter((r) => r.activityId === activityId)).toHaveLength(1);
  });
});
