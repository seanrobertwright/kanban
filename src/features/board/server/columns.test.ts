import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ColumnActivity } from "@/features/activity/types";
import { createTask } from "@/features/tasks/server/repository";
import { AuthzError } from "@/features/workspaces/server/authz";
import {
  addMember,
  ensurePersonalWorkspace,
  getDefaultBoard,
} from "@/features/workspaces/server/repository";
import { pool, query } from "@/shared/db/client";
import {
  createColumn,
  deleteColumn,
  moveColumn,
  updateColumn,
} from "./columns";
import { getBoard } from "./repository";

/**
 * Against a real Postgres. The two things most worth proving here are things
 * only the database can do: that deleting a populated column would CASCADE its
 * tasks away (so the 409 guard is load-bearing rather than decorative), and that
 * the FOR UPDATE lock actually closes the window between counting the tasks and
 * doing the delete.
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

/** Narrows a log row to its column arm, failing loudly if it is not one. */
function asColumn(entry: {
  action: string;
}): ColumnActivity {
  if (!entry.action.startsWith("column.")) {
    throw new Error(`Expected a column entry, got ${entry.action}`);
  }
  return entry as ColumnActivity;
}

/**
 * Column entries carry a null task_id, so listRawActivityForTask cannot see
 * them — M1 renders per-task history only, and nothing reads these yet. They are
 * still written, because the criterion is that every mutation writes a row and
 * because M2's undo replays them. This reads them the way a board-level feed
 * eventually will.
 */
async function columnLog(boardId: number): Promise<ColumnActivity[]> {
  return query<ColumnActivity>(
    `SELECT id, workspace_id AS "workspaceId", board_id AS "boardId",
            task_id AS "taskId", actor_type AS "actorType", actor_id AS "actorId",
            action, before, after, created_at AS "createdAt"
       FROM activity_log
      WHERE board_id = $1 AND action LIKE 'column.%'
      ORDER BY id DESC`,
    [boardId]
  );
}

describe("columns", () => {
  let alice: string; // owner
  let bob: string; // member
  let carol: string; // viewer
  let boardId: number;

  beforeAll(async () => {
    alice = await createUser("col-alice");
    bob = await createUser("col-bob");
    carol = await createUser("col-carol");

    const workspaceId = (await ensurePersonalWorkspace(alice, "ColAlice")).id;
    await addMember(alice, workspaceId, bob, "member");
    await addMember(alice, workspaceId, carol, "viewer");

    boardId = (await getDefaultBoard(alice))!.id;
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

  const titles = async () =>
    (await getBoard(alice, boardId))!.columns.map((c) => c.title);

  describe("creating", () => {
    it("appends a column to the end of the board", async () => {
      const column = await createColumn(alice, boardId, "Blocked");
      const board = await getBoard(alice, boardId);
      expect(board!.columns.at(-1)!.id).toBe(column.id);
      expect(column.title).toBe("Blocked");
    });

    it("lets a member add one without an admin", async () => {
      // Blast radius, not rank: adding a column is cheap and reversible, and
      // needing a ticket to an admin for it is friction on an ordinary action.
      const column = await createColumn(bob, boardId, "In Review");
      expect(column.id).toBeDefined();
      await deleteColumn(alice, column.id);
    });

    it("refuses a viewer", async () => {
      const error = await createColumn(carol, boardId, "Nope").catch((e) => e);
      expect(error).toBeInstanceOf(AuthzError);
      expect(error.kind).toBe("forbidden");
    });

    it("logs column.created with no before", async () => {
      const column = await createColumn(alice, boardId, "Logged create");
      const [entry] = await columnLog(boardId);
      const logged = asColumn(entry);
      expect(logged.action).toBe("column.created");
      expect(logged.actorId).toBe(alice);
      expect(logged.before).toBeNull();
      expect(logged.after).toEqual({
        columnId: column.id,
        title: "Logged create",
        position: column.position,
        wipLimit: null,
      });
      // The subject is the column; no task locates it.
      expect(logged.taskId).toBeNull();
      await deleteColumn(alice, column.id);
    });
  });

  describe("renaming", () => {
    it("renames a column", async () => {
      const column = await createColumn(alice, boardId, "Typo");
      const renamed = await updateColumn(alice, column.id, "Fixed");
      expect(renamed!.title).toBe("Fixed");
      await deleteColumn(alice, column.id);
    });

    it("writes no row for a rename that changed nothing", async () => {
      const column = await createColumn(alice, boardId, "Same");
      await updateColumn(alice, column.id, "Same");
      const entries = await columnLog(boardId);
      expect(entries[0].action).toBe("column.created");
      await deleteColumn(alice, column.id);
    });

    it("logs column.updated with both titles", async () => {
      const column = await createColumn(alice, boardId, "Old name");
      await updateColumn(alice, column.id, "New name");
      const [entry] = await columnLog(boardId);
      const logged = asColumn(entry);
      expect(logged.action).toBe("column.updated");
      expect(logged.before!.title).toBe("Old name");
      expect(logged.after!.title).toBe("New name");
      await deleteColumn(alice, column.id);
    });

    it("refuses a viewer", async () => {
      const column = await createColumn(alice, boardId, "Guarded");
      const error = await updateColumn(carol, column.id, "Hacked").catch((e) => e);
      expect(error).toBeInstanceOf(AuthzError);
      expect(error.kind).toBe("forbidden");
      await deleteColumn(alice, column.id);
    });
  });

  describe("reordering", () => {
    it("moves a column and shifts its siblings around it", async () => {
      const before = await titles();
      const board = await getBoard(alice, boardId);
      const last = board!.columns.at(-1)!;

      await moveColumn(alice, last.id, 0);

      const after = await titles();
      expect(after[0]).toBe(last.title);
      expect(after).toHaveLength(before.length);
      // Everything else keeps its relative order; only the moved one jumped.
      expect(after.slice(1)).toEqual(before.filter((t) => t !== last.title));

      await moveColumn(alice, last.id, before.length - 1);
      expect(await titles()).toEqual(before);
    });

    it("clamps a position past the end instead of leaving a hole", async () => {
      const board = await getBoard(alice, boardId);
      const first = board!.columns[0];
      const moved = await moveColumn(alice, first.id, 999);
      expect(moved!.position).toBe(board!.columns.length - 1);
      await moveColumn(alice, first.id, 0);
    });

    it("writes no row for a move that changed nothing", async () => {
      const column = await createColumn(alice, boardId, "Stationary");
      await moveColumn(alice, column.id, column.position);
      const entries = await columnLog(boardId);
      expect(entries[0].action).toBe("column.created");
      await deleteColumn(alice, column.id);
    });
  });

  describe("deleting", () => {
    it("deletes an empty column and closes the gap", async () => {
      const column = await createColumn(alice, boardId, "Doomed");
      expect(await deleteColumn(alice, column.id)).toBe(true);

      const board = await getBoard(alice, boardId);
      expect(board!.columns.map((c) => c.title)).not.toContain("Doomed");
      // Positions stay contiguous from zero, or the next insert collides.
      expect(board!.columns.map((c) => c.position)).toEqual(
        board!.columns.map((_, i) => i)
      );
    });

    it("REFUSES a column that still holds tasks, with 409", async () => {
      // The guard is load-bearing, not decorative: task.column_id is ON DELETE
      // CASCADE, so without this the delete would take the tasks with it —
      // silently, and without one activity_log row to say where they went.
      const column = await createColumn(alice, boardId, "Populated");
      await createTask(alice, { columnId: column.id, title: "Hostage" });

      const error = await deleteColumn(alice, column.id).catch((e) => e);
      expect(error).toBeInstanceOf(AuthzError);
      // conflict, not forbidden: an admin may attempt this, and the refusal is
      // an invariant rather than a permission. 409, like the last owner.
      expect(error.kind).toBe("conflict");

      // And the column is still there, with its task.
      const board = await getBoard(alice, boardId);
      expect(board!.columns.map((c) => c.title)).toContain("Populated");
      expect(board!.tasks.filter((t) => t.columnId === column.id)).toHaveLength(1);
    });

    it("proves the CASCADE the guard exists to prevent is real", async () => {
      // Not testing our code — testing the schema, to show the guard above is
      // the only thing standing between a button and lost work. If this ever
      // fails, the FK changed and the 409 guard's rationale needs rereading.
      const column = await createColumn(alice, boardId, "Cascade proof");
      const task = await createTask(alice, {
        columnId: column.id,
        title: "Will vanish",
      });

      await query(`DELETE FROM board_column WHERE id = $1`, [column.id]);

      const survivors = await query(`SELECT id FROM task WHERE id = $1`, [task.id]);
      expect(survivors).toHaveLength(0);
    });

    it("does not let a task slip in between the count and the delete", async () => {
      // The claim deleteColumn's FOR UPDATE makes, tested rather than asserted.
      // Postgres takes a FOR KEY SHARE lock on the referenced board_column row
      // when a task is inserted, and FOR UPDATE conflicts with it — so a
      // concurrent createTask must block here, not sail past the count.
      const column = await createColumn(alice, boardId, "Raced");
      const a = await pool.connect();
      const b = await pool.connect();
      try {
        await a.query("BEGIN");
        await a.query(`SELECT id FROM board_column WHERE id = $1 FOR UPDATE`, [
          column.id,
        ]);

        await b.query("BEGIN");
        const insert = b.query(
          `INSERT INTO task (column_id, title, position) VALUES ($1, 'Sneaky', 0)`,
          [column.id]
        );

        // If the lock does nothing, this resolves and the race is open.
        const outcome = await Promise.race([
          insert.then(() => "inserted"),
          new Promise((r) => setTimeout(() => r("blocked"), 400)),
        ]);
        expect(outcome).toBe("blocked");

        await a.query(`DELETE FROM board_column WHERE id = $1`, [column.id]);
        await a.query("COMMIT");

        // Unblocked, and now refused by the foreign key: the column is gone.
        // That is the honest outcome — better a failed insert than a task
        // silently cascaded away by a delete that counted zero.
        await expect(insert).rejects.toThrow();
        await b.query("ROLLBACK");
      } finally {
        a.release();
        b.release();
      }
    });

    it("refuses a member — deleting takes admin", async () => {
      const column = await createColumn(alice, boardId, "Member cannot");
      const error = await deleteColumn(bob, column.id).catch((e) => e);
      expect(error).toBeInstanceOf(AuthzError);
      expect(error.kind).toBe("forbidden");
      await deleteColumn(alice, column.id);
    });

    it("logs column.deleted carrying the title, since the column is gone", async () => {
      const column = await createColumn(alice, boardId, "Remember me");
      await deleteColumn(alice, column.id);

      const [entry] = await columnLog(boardId);
      const logged = asColumn(entry);
      expect(logged.action).toBe("column.deleted");
      // Without the title on the row, the record of a deletion could never name
      // what was deleted — the board has no such column to resolve it against.
      expect(logged.before!.title).toBe("Remember me");
      expect(logged.after).toBeNull();
    });

    it("lets the last column go, because that is recoverable", async () => {
      // Unlike the last owner, an empty board is not an unreachable state: you
      // add a column back. So this is allowed rather than refused.
      const solo = await ensurePersonalWorkspace(
        await createUser("col-solo"),
        "ColSolo"
      );
      const owner = (
        await query<{ userId: string }>(
          `SELECT user_id AS "userId" FROM workspace_member WHERE workspace_id = $1`,
          [solo.id]
        )
      )[0].userId;
      const board = (await getDefaultBoard(owner))!;

      for (const column of (await getBoard(owner, board.id))!.columns) {
        await deleteColumn(owner, column.id);
      }
      expect((await getBoard(owner, board.id))!.columns).toEqual([]);

      const restored = await createColumn(owner, board.id, "Back again");
      expect(restored.position).toBe(0);
    });
  });
});
