import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getBoard } from "@/features/board/server/repository";
import { createLabel } from "@/features/labels/server/repository";
import {
  ensurePersonalWorkspace,
  getDefaultBoard,
} from "@/features/workspaces/server/repository";
import { pool, query } from "@/shared/db/client";
import { createTask, searchTasks } from "./repository";

/**
 * Against a real Postgres because every claim here is a SQL claim: the ILIKE
 * escaping, the three-valued assignee filter, the label conjunction, and the
 * keyset page boundary are all things a mock would agree with while the
 * database disagreed. The escaping test in particular is the one that would
 * pass against any fake — `%` is only special to a real LIKE.
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

describe("board task search", () => {
  let alice: string;
  let stranger: string;
  let workspaceId: string;
  let boardId: number;
  let columnId: number;
  let otherColumnId: number;

  beforeAll(async () => {
    alice = await createUser("search-alice");
    stranger = await createUser("search-stranger");
    workspaceId = (await ensurePersonalWorkspace(alice, "SearchAlice")).id;
    await ensurePersonalWorkspace(stranger, "SearchStranger");
    boardId = (await getDefaultBoard(alice))!.id;
    const board = (await getBoard(alice, boardId))!;
    columnId = board.columns[0].id;
    otherColumnId = board.columns[1].id;
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

  it("matches a substring of the title or the description", async () => {
    await createTask(alice, { columnId, title: "Refresh the auth token" });
    await createTask(alice, {
      columnId,
      title: "Unrelated",
      description: "the auth token expiry is wrong",
    });
    await createTask(alice, { columnId, title: "Paint the shed" });

    const { tasks } = await searchTasks(alice, boardId, { text: "auth token" });
    expect(tasks.map((t) => t.title).sort()).toEqual([
      "Refresh the auth token",
      "Unrelated",
    ]);
  });

  it("treats LIKE metacharacters as literal text", async () => {
    await createTask(alice, { columnId, title: "Ship at 100% coverage" });
    await createTask(alice, { columnId, title: "Ship at 90 percent" });

    // Unescaped, "100%" would be "100 followed by anything" and would still
    // match only the first — so the discriminating query is the bare "%",
    // which unescaped matches every task on the board.
    const { tasks } = await searchTasks(alice, boardId, { text: "%" });
    expect(tasks.map((t) => t.title)).toEqual(["Ship at 100% coverage"]);
  });

  it("filters by column, priority, and type together", async () => {
    await createTask(alice, {
      columnId,
      title: "Match everything",
      priority: "urgent",
      type: "bug",
    });
    await createTask(alice, {
      columnId: otherColumnId,
      title: "Wrong column",
      priority: "urgent",
      type: "bug",
    });
    await createTask(alice, {
      columnId,
      title: "Wrong priority",
      priority: "low",
      type: "bug",
    });

    const { tasks } = await searchTasks(alice, boardId, {
      columnId,
      priority: "urgent",
      type: "bug",
    });
    expect(tasks.map((t) => t.title)).toEqual(["Match everything"]);
  });

  it("reads assignee three ways: absent, unassigned, and a principal", async () => {
    const mine = await createTask(alice, {
      columnId,
      title: "Assigned to alice",
      assignee: { type: "human", id: alice },
    });
    const free = await createTask(alice, { columnId, title: "Nobody's task" });

    const held = await searchTasks(alice, boardId, {
      assignee: { type: "human", id: alice },
      text: "Assigned to alice",
    });
    expect(held.tasks.map((t) => t.id)).toEqual([mine.id]);

    const unassigned = await searchTasks(alice, boardId, {
      assignee: null,
      text: "Nobody's task",
    });
    expect(unassigned.tasks.map((t) => t.id)).toEqual([free.id]);
  });

  it("requires every label asked for, not any of them", async () => {
    const red = await createLabel(alice, workspaceId, { name: `red-${randomUUID()}` });
    const blue = await createLabel(alice, workspaceId, { name: `blue-${randomUUID()}` });
    const both = await createTask(alice, {
      columnId,
      title: "Two labels",
      labelIds: [red.id, blue.id],
    });
    await createTask(alice, {
      columnId,
      title: "One label",
      labelIds: [red.id],
    });

    const { tasks } = await searchTasks(alice, boardId, {
      labelIds: [red.id, blue.id],
    });
    expect(tasks.map((t) => t.id)).toEqual([both.id]);
  });

  it("leaves subtasks out unless asked, since a board's items are its roots", async () => {
    const parent = await createTask(alice, { columnId, title: "Parent piecework" });
    const piece = await createTask(alice, {
      columnId,
      parentId: parent.id,
      title: "Piece of piecework",
    });

    const roots = await searchTasks(alice, boardId, { text: "piecework" });
    expect(roots.tasks.map((t) => t.id)).toEqual([parent.id]);

    const all = await searchTasks(alice, boardId, {
      text: "piecework",
      includeSubtasks: true,
    });
    expect(all.tasks.map((t) => t.id).sort()).toEqual([parent.id, piece.id].sort());
  });

  it("pages by cursor and stops with a null one", async () => {
    const marker = `page-${randomUUID()}`;
    for (let i = 0; i < 3; i += 1) {
      await createTask(alice, { columnId, title: `${marker} ${i}` });
    }

    const first = await searchTasks(alice, boardId, { text: marker, limit: 2 });
    expect(first.tasks).toHaveLength(2);
    expect(first.nextCursor).toBe(first.tasks[1].id);

    const second = await searchTasks(alice, boardId, {
      text: marker,
      limit: 2,
      cursor: first.nextCursor!,
    });
    expect(second.tasks).toHaveLength(1);
    // A short page is the last page — no extra round trip to discover it.
    expect(second.nextCursor).toBeNull();
    // No row appeared twice across the two pages.
    const ids = [...first.tasks, ...second.tasks].map((t) => t.id);
    expect(new Set(ids).size).toBe(3);
  });

  it("answers a stranger with the board's own not-found, never a hit count", async () => {
    await createTask(alice, { columnId, title: "Confidential roadmap" });
    await expect(
      searchTasks(stranger, boardId, { text: "Confidential" })
    ).rejects.toMatchObject({ kind: "not_found" });
  });
});
