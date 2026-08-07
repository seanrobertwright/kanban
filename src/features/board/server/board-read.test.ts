import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { addDependency } from "@/features/dependencies/server/repository";
import { createEpic } from "@/features/epics/server/repository";
import { createMilestone } from "@/features/milestones/server/repository";
import { createTask } from "@/features/tasks/server/repository";
import {
  ensurePersonalWorkspace,
  getDefaultBoard,
} from "@/features/workspaces/server/repository";
import { pool, query } from "@/shared/db/client";
import { getBoard } from "./repository";

/**
 * The board read is the only path the page actually takes, and it was the one no
 * suite covered: the task tests exercise createTask and updateTask, which return
 * their own rows, so a field this query forgets is invisible to every one of
 * them. 006 landed exactly that way — priority and due_date reached the database,
 * the repository and the API, and never reached a card, because getBoard listed
 * its columns by hand and the list drifted.
 *
 * `query<Task>` cannot catch it. It is a cast, not a check: pg never sees the
 * type, so a SELECT returning seven of nine columns type-checks perfectly and
 * fails only in the browser, as an undefined where a value should be.
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

describe("getBoard", () => {
  let alice: string;
  let boardId: number;
  let todoId: number;

  beforeAll(async () => {
    alice = await createUser("bread-alice");
    await ensurePersonalWorkspace(alice, "BReadAlice");
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

  it("returns whole tasks, not the subset this query happens to list", async () => {
    // toEqual against createTask's own return rather than a literal, and that is
    // the design of the test: it needs no maintenance when a field is added, and
    // it fails the moment the two column lists disagree. A literal here would
    // have to be updated by the same person who forgot the SELECT.
    //
    // The values are deliberately non-default. A task with priority 'none' and no
    // due date would pass against a query that returns neither — toEqual is the
    // only thing separating undefined from the value that means "empty".
    const created = await createTask(alice, {
      columnId: todoId,
      title: "Whole",
      description: "every field",
      assignee: { type: "human", id: alice },
      priority: "urgent",
      dueDate: "2026-08-01",
    });

    const board = await getBoard(alice, boardId);
    const task = board!.tasks.find((t) => t.id === created.id);

    expect(task).toEqual(created);
  });

  // The same drift this file was written about, in the milestone read (UI-5).
  // getBoard hand-wrote its own milestone SELECT to avoid listMilestones' second
  // authz query, and that copy left out epic_id and objective_id — so every
  // milestone reached the Roadmap with no epic, and the Roadmap groups its
  // swimlanes by exactly that field. Filed under an epic in the database,
  // rendered under "Unfiled" on screen, with nothing in between to notice.
  //
  // toEqual against createMilestone's own return, the whole-task test's trick:
  // it needs no maintenance, and it fails the moment the two lists disagree
  // again. A non-null epicId is the point — a milestone with none would pass
  // against a query that never returns the column.
  it("returns whole milestones, epic and objective links included", async () => {
    const epic = await createEpic(
      alice,
      boardId,
      { name: "Engine" },
      { type: "human", id: alice }
    );
    const created = await createMilestone(
      alice,
      boardId,
      { name: "Rolling chassis", dueDate: "2026-09-05", epicId: epic.id },
      { type: "human", id: alice }
    );

    const board = await getBoard(alice, boardId);
    const milestone = board!.milestones.find((m) => m.id === created.id);

    expect(milestone).toEqual(created);
  });

  it("returns the board's blocked-by edges for the Gantt (036)", async () => {
    // Two tasks and one edge: the read must surface the relationship board-wide
    // the way the Gantt reads it to draw arrows and the critical path — which
    // since 087 means the link too, because the arrow's anchors and the path's
    // arithmetic both depend on what the edge means.
    const blocker = await createTask(alice, { columnId: todoId, title: "First" });
    const dependent = await createTask(alice, {
      columnId: todoId,
      title: "Second",
    });
    await addDependency(alice, dependent.id, blocker.id);

    const board = await getBoard(alice, boardId);

    expect(board!.dependencies).toContainEqual({
      taskId: dependent.id,
      dependsOnId: blocker.id,
      type: "FS",
      lagDays: 0,
    });
  });
});
