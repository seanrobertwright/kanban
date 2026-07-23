import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getBoard } from "@/features/board/server/repository";
import { createTask } from "@/features/tasks/server/repository";
import {
  ensurePersonalWorkspace,
  getDefaultBoard,
} from "@/features/workspaces/server/repository";
import { pool, query } from "@/shared/db/client";

import {
  createReport,
  deleteReport,
  listReports,
  runReportById,
  updateReport,
} from "./repository";

/**
 * Custom reports (5.1): the definition CRUD, the visibility/authoring gates, and
 * the tasks-source pipeline (scoped SQL → reused filter → group → runReport).
 */
describe("reports (db)", () => {
  const createdUsers: string[] = [];
  let alice: string;
  let workspaceId: string;
  let boardId: number;
  let todoCol: number;
  let doneCol: number;

  beforeAll(async () => {
    alice = `test-rep-alice-${randomUUID()}`;
    await query(
      `INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, true)`,
      [alice, "Rae Port", `${alice}@example.test`]
    );
    createdUsers.push(alice);
    await ensurePersonalWorkspace(alice, "RepAlice");
    const board = (await getDefaultBoard(alice))!;
    boardId = board.id;
    workspaceId = board.workspaceId;
    const cols = (await getBoard(alice, boardId))!.columns;
    todoCol = cols[0].id;
    doneCol = cols[cols.length - 1].id;

    await createTask(alice, { columnId: todoCol, title: "Ship login", priority: "high", estimate: 3 });
    await createTask(alice, { columnId: todoCol, title: "Fix crash", priority: "high", estimate: 5 });
    await createTask(alice, { columnId: doneCol, title: "Write docs", priority: "low", estimate: 2 });
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

  it("counts tasks grouped by status", async () => {
    const report = await createReport(alice, workspaceId, {
      name: `count-by-status-${randomUUID()}`,
      source: "tasks",
      boardId,
      metric: "count",
      groupBy: "status",
    });
    const { result } = await runReportById(alice, report.id);
    const byLabel = Object.fromEntries(result.points.map((p) => [p.label, p.value]));
    expect(result.total).toBe(3);
    // Two tasks in the first column, one in the last.
    expect(Math.max(...result.points.map((p) => p.value))).toBe(2);
    expect(byLabel).toHaveProperty(Object.keys(byLabel)[0]);
  });

  it("sums estimate grouped by priority", async () => {
    const report = await createReport(alice, workspaceId, {
      name: `est-by-prio-${randomUUID()}`,
      source: "tasks",
      boardId,
      metric: "sum:estimate",
      groupBy: "priority",
    });
    const { result } = await runReportById(alice, report.id);
    const byLabel = Object.fromEntries(result.points.map((p) => [p.label, p.value]));
    expect(byLabel.high).toBe(8);
    expect(byLabel.low).toBe(2);
    expect(result.total).toBe(10);
  });

  it("applies the reused saved-view filter (text search) before aggregating", async () => {
    const report = await createReport(alice, workspaceId, {
      name: `filtered-${randomUUID()}`,
      source: "tasks",
      boardId,
      metric: "count",
      groupBy: "none",
      filter: { text: "crash", priorities: [], labelIds: [], assignees: [] },
    });
    const { result } = await runReportById(alice, report.id);
    expect(result.total).toBe(1);
  });

  it("refuses a duplicate report name in the workspace", async () => {
    const name = `dupe-${randomUUID()}`;
    await createReport(alice, workspaceId, { name, source: "tasks", metric: "count" });
    await expect(
      createReport(alice, workspaceId, { name, source: "tasks", metric: "count" })
    ).rejects.toThrow(/already exists/);
  });

  it("hides a private report from another member but shows a shared one", async () => {
    // Bob joins Alice's workspace as a member.
    const bob = `test-rep-bob-${randomUUID()}`;
    await query(
      `INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, true)`,
      [bob, "Bo Bard", `${bob}@example.test`]
    );
    createdUsers.push(bob);
    await query(
      `INSERT INTO workspace_member (workspace_id, user_id, role) VALUES ($1, $2, 'member')`,
      [workspaceId, bob]
    );

    const priv = await createReport(alice, workspaceId, {
      name: `priv-${randomUUID()}`,
      source: "tasks",
      metric: "count",
      visibility: "private",
    });
    const bobList = await listReports(bob, workspaceId);
    expect(bobList.some((r) => r.id === priv.id)).toBe(false);
    // Bob cannot even run Alice's private report.
    await expect(runReportById(bob, priv.id)).rejects.toThrow();

    // A member cannot author a shared report (needs admin).
    await expect(
      createReport(bob, workspaceId, {
        name: `bob-shared-${randomUUID()}`,
        source: "tasks",
        metric: "count",
        visibility: "shared",
      })
    ).rejects.toThrow();
  });

  it("rejects an incompatible metric on update", async () => {
    const report = await createReport(alice, workspaceId, {
      name: `flip-${randomUUID()}`,
      source: "tasks",
      metric: "count",
      groupBy: "status",
    });
    // tasks cannot produce sum:minutes.
    await expect(
      updateReport(alice, report.id, { metric: "sum:minutes" })
    ).rejects.toThrow(/not valid/);
    // Deleting cleans up.
    expect(await deleteReport(alice, report.id)).toBe(true);
  });
});
