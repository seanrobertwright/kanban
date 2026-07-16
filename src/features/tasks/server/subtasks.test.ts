import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { listRawActivityForTask } from "@/features/activity/server/repository";
import { getBoard } from "@/features/board/server/repository";
import {
  createBoard,
  ensurePersonalWorkspace,
  getDefaultBoard,
} from "@/features/workspaces/server/repository";
import { pool, query } from "@/shared/db/client";
import {
  createTask,
  deleteTask,
  getTask,
  listSubtasks,
  moveTask,
  updateTask,
} from "./repository";

/**
 * Against a real Postgres, because almost everything here is what the *database*
 * enforces and a mock would agree with every one of these while proving none: a
 * CASCADE that takes the pieces, a trigger that freezes the parent, and a
 * position scoped to (column_id, parent_id) so a piece and a top-level task can
 * both be at 0 without colliding. 008's whole design is invariants the schema
 * holds, and this is where they are held to it.
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

describe("subtasks", () => {
  let alice: string;
  let boardId: number;
  let workspaceId: string;
  let todoId: number;
  let doingId: number;
  // A second board in Alice's own workspace: the same-board invariant is about
  // boards, not tenancy, and this is the case an authz check alone waves through.
  let otherBoardColId: number;
  // Bob, a stranger: his tasks must be unreachable as parents, and as not_found
  // rather than forbidden, or the id space becomes an oracle.
  let bobTaskId: number;

  beforeAll(async () => {
    alice = await createUser("sub-alice");
    await ensurePersonalWorkspace(alice, "SubAlice");
    const board = (await getDefaultBoard(alice))!;
    boardId = board.id;
    workspaceId = board.workspaceId;
    const cols = (await getBoard(alice, boardId))!.columns;
    todoId = cols[0].id;
    doingId = cols[1].id;

    const boardB = await createBoard(alice, workspaceId, "Board B");
    otherBoardColId = (await getBoard(alice, boardB.id))!.columns[0].id;

    const bob = await createUser("sub-bob");
    await ensurePersonalWorkspace(bob, "SubBob");
    const bobBoard = (await getDefaultBoard(bob))!;
    const bobTodo = (await getBoard(bob, bobBoard.id))!.columns[0].id;
    bobTaskId = (await createTask(bob, { columnId: bobTodo, title: "Bob's" }))
      .id;
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

  const newTask = (over: Record<string, unknown> = {}) =>
    createTask(alice, { columnId: todoId, title: "A task", ...over });

  describe("creation", () => {
    it("is born a piece of the task named as its parent", async () => {
      const parent = await newTask();
      const piece = await newTask({ parentId: parent.id });
      expect(piece.parentId).toBe(parent.id);
    });

    it("starts at position 0 among its parent's pieces, whatever the column holds", async () => {
      // The scope split 008 made concrete. The column already holds top-level
      // tasks at 0,1,2…, but a piece's position counts only its siblings — so the
      // first child is 0 and the second is 1, regardless of how full the column
      // is. Without the parent_id clause in the INSERT it would take the next
      // column position and leave a hole the board renders as a gap.
      await newTask();
      await newTask();
      const parent = await newTask();

      const first = await newTask({ parentId: parent.id });
      const second = await newTask({ parentId: parent.id });
      expect(first.position).toBe(0);
      expect(second.position).toBe(1);
    });

    it("does not disturb the positions of the column's top-level tasks", async () => {
      // A subtask insert renumbers nothing — it computes MAX(position)+1 within
      // its sibling set and inserts. The top-level tasks it renders beside must be
      // exactly where they were.
      const before = (await getBoard(alice, boardId))!.tasks
        .filter((t) => t.columnId === todoId)
        .map((t) => [t.id, t.position] as const);
      const parent = before.length
        ? { id: before[0][0] }
        : await newTask();
      await newTask({ parentId: parent.id });
      const after = (await getBoard(alice, boardId))!.tasks
        .filter((t) => t.columnId === todoId)
        .map((t) => [t.id, t.position] as const);
      expect(after).toEqual(before);
    });

    it("counts a task's pieces on the task, and zero on a piece", async () => {
      // Derived, not stored: subtaskCount is a fact about other rows. A parent
      // reports its pieces; a piece, being a leaf at depth 1, reports none.
      const parent = await newTask();
      await newTask({ parentId: parent.id });
      const piece = await newTask({ parentId: parent.id });

      expect((await getTask(alice, parent.id))!.subtaskCount).toBe(2);
      expect((await getTask(alice, piece.id))!.subtaskCount).toBe(0);
    });
  });

  describe("the board renders tasks, not their pieces", () => {
    it("excludes subtasks from getBoard", async () => {
      // WHERE parent_id IS NULL is what makes the board a board: without it a
      // parent and its pieces arrive as sibling cards. The pieces are reached
      // through the parent's dialog instead (listSubtasks).
      const parent = await newTask();
      const piece = await newTask({ parentId: parent.id });

      const ids = (await getBoard(alice, boardId))!.tasks.map((t) => t.id);
      expect(ids).toContain(parent.id);
      expect(ids).not.toContain(piece.id);
    });
  });

  describe("listing a task's pieces", () => {
    it("groups them by status in the board's own column order", async () => {
      // Ordered by the column's position, not the piece's — a piece's position is
      // scoped to its column, so three pieces across three columns are each at 0,
      // and ordering by position alone would interleave them arbitrarily. The
      // reader already has the board's left-to-right order in their head.
      const parent = await newTask();
      const inDoing = await newTask({ parentId: parent.id, columnId: doingId });
      const inTodo = await newTask({ parentId: parent.id, columnId: todoId });

      const pieces = await listSubtasks(alice, parent.id);
      expect(pieces.map((p) => p.id)).toEqual([inTodo.id, inDoing.id]);
    });
  });

  describe("depth is one", () => {
    it("refuses to give a subtask subtasks of its own", async () => {
      // A conflict, not a permission: the caller may attempt it, and the refusal
      // is the invariant. The check reads the parent's own parent_id, which the
      // trigger makes immutable — so it needs no lock, the answer being permanent
      // the instant it is read.
      const parent = await newTask();
      const piece = await newTask({ parentId: parent.id });

      await expect(newTask({ parentId: piece.id })).rejects.toMatchObject({
        kind: "conflict",
      });
    });
  });

  describe("a piece stays on its parent's board", () => {
    it("refuses a parent on another board of the same workspace, as forbidden", async () => {
      // The case tenancy alone waves through: Alice may touch both boards, but
      // that never proves the two sides belong together. moveTask's check, one
      // level out.
      const parent = await newTask();
      await expect(
        createTask(alice, {
          columnId: otherBoardColId,
          title: "misplaced piece",
          parentId: parent.id,
        })
      ).rejects.toMatchObject({ kind: "forbidden" });
    });

    it("hides a parent in another workspace as not_found, never forbidden", async () => {
      // The id space must not become an oracle for what exists elsewhere. This is
      // requireTaskRole's 404, inherited rather than restated.
      await expect(
        newTask({ parentId: bobTaskId })
      ).rejects.toMatchObject({ kind: "not_found" });
    });
  });

  describe("deleting a task takes its pieces, and logs each", () => {
    it("removes the pieces and records where each went", async () => {
      // The CASCADE would take the pieces silently; deleteTask logs each first, so
      // a reader of a piece's history — the only audience for why it vanished —
      // finds the row, and undo (M2) can recreate each piece rather than a count.
      const parent = await newTask();
      const one = await newTask({ parentId: parent.id, title: "piece one" });
      const two = await newTask({ parentId: parent.id, title: "piece two" });

      expect(await deleteTask(alice, parent.id)).toBe(true);

      const remaining = await query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM task WHERE id = ANY($1::int[])`,
        [[parent.id, one.id, two.id]]
      );
      expect(remaining[0].n).toBe("0");

      // Each piece's own history carries its deletion, with a `before` whole
      // enough to recreate it — parent_id included, which is what puts it back
      // under the parent rather than onto the board as a card that never was.
      for (const piece of [one, two]) {
        const actions = (await listRawActivityForTask(piece.id)).map(
          (e) => e.action
        );
        expect(actions).toContain("task.deleted");
        const deleted = (await listRawActivityForTask(piece.id)).find(
          (e) => e.action === "task.deleted"
        )!;
        expect((deleted.before as { parentId?: number }).parentId).toBe(
          parent.id
        );
      }

      // And the parent's own deletion is logged too — it is not merely the agent
      // of the cascade, it was deleted.
      const parentActions = (await listRawActivityForTask(parent.id)).map(
        (e) => e.action
      );
      expect(parentActions).toContain("task.deleted");
    });
  });

  describe("a piece's parent never changes", () => {
    it("rejects a re-parenting UPDATE at the database", async () => {
      // The depth-1 check is race-free only because parent_id cannot move. That
      // invariant lives nowhere near the code that depends on it, so the database
      // holds it: someone adding re-parenting has to break this trigger on
      // purpose. updateTask has no parentId path, so this is reached by raw SQL —
      // the only way to attempt it.
      const parent = await newTask();
      const other = await newTask();
      const piece = await newTask({ parentId: parent.id });

      await expect(
        query(`UPDATE task SET parent_id = $1 WHERE id = $2`, [
          other.id,
          piece.id,
        ])
      ).rejects.toThrow(/immutable|re-parenting/);

      // Promoting a piece to a top-level task is re-parenting too, and equally
      // refused.
      await expect(
        query(`UPDATE task SET parent_id = NULL WHERE id = $1`, [piece.id])
      ).rejects.toThrow(/immutable|re-parenting/);
    });

    it("lets an ordinary update through untouched", async () => {
      // IS DISTINCT FROM, not <>: an ordinary update leaves parent_id equal to
      // itself, and the trigger must see that as no change. `<>` would read
      // NULL <> NULL as NULL and let nothing through — every edit would fail.
      const piece = await newTask({ parentId: (await newTask()).id });
      const renamed = await updateTask(alice, piece.id, { title: "renamed" });
      expect(renamed!.title).toBe("renamed");
    });
  });

  describe("moving a piece", () => {
    it("reorders within its sibling set, leaving the column's tasks alone", async () => {
      // Every position query in moveTask is scoped to (column_id, parent_id). A
      // piece moving among its siblings must not shuffle the top-level tasks that
      // share its column — the bug 008's worked example describes.
      const parent = await newTask();
      const first = await newTask({ parentId: parent.id, title: "first" });
      const second = await newTask({ parentId: parent.id, title: "second" });

      const columnBefore = (await getBoard(alice, boardId))!.tasks
        .filter((t) => t.columnId === todoId)
        .map((t) => [t.id, t.position] as const);

      await moveTask(alice, first.id, { columnId: todoId, position: 1 });

      // The siblings swapped…
      const pieces = await listSubtasks(alice, parent.id);
      expect(pieces.map((p) => p.id)).toEqual([second.id, first.id]);
      // …and every top-level task in the column is exactly where it was.
      const columnAfter = (await getBoard(alice, boardId))!.tasks
        .filter((t) => t.columnId === todoId)
        .map((t) => [t.id, t.position] as const);
      expect(columnAfter).toEqual(columnBefore);
    });

    it("moves a piece to another column and clamps to its end", async () => {
      // A large position appends — the client sends one to mean "the end" and the
      // server clamps, which is how the Status control moves a piece across the
      // workflow. The piece flows independently of its parent (008): parent in
      // Todo, piece in Doing is decomposition working, not a violation.
      const parent = await newTask();
      const piece = await newTask({ parentId: parent.id });

      const moved = await moveTask(alice, piece.id, {
        columnId: doingId,
        position: Number.MAX_SAFE_INTEGER,
      });
      expect(moved!.columnId).toBe(doingId);
      // Still its parent's piece — a move changes status, never parentage.
      expect(moved!.parentId).toBe(parent.id);
    });
  });
});
