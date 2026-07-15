import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getBoard } from "@/features/board/server/repository";
import {
  createTask,
  deleteTask,
  getTask,
  moveTask,
  updateTask,
} from "@/features/tasks/server/repository";
import { pool, query } from "@/shared/db/client";
import { AuthzError } from "./authz";
import {
  addMember,
  createBoard,
  createWorkspace,
  ensurePersonalWorkspace,
  getDefaultBoard,
  listBoards,
  listBoardsForUser,
  listWorkspacesForUser,
} from "./repository";

/**
 * These tests run against the real database rather than a mock. Tenancy is a
 * property of the SQL — a mocked client would happily confirm joins that
 * Postgres would reject, which is exactly the bug class this milestone exists
 * to prevent.
 */

async function createUser(label: string): Promise<string> {
  const id = `test-${label}-${randomUUID()}`;
  await query(
    `INSERT INTO "user" (id, name, email, "emailVerified")
     VALUES ($1, $2, $3, true)`,
    [id, `Test ${label}`, `${id}@example.test`]
  );
  return id;
}

/** Fails the test unless `fn` throws an AuthzError of the expected kind. */
async function expectAuthzError(
  fn: () => Promise<unknown>,
  kind: "not_found" | "forbidden"
) {
  await expect(fn()).rejects.toThrow(AuthzError);
  await expect(fn()).rejects.toMatchObject({ kind });
}

describe("workspace tenancy", () => {
  let alice: string;
  let bob: string;
  let viewer: string;
  let aliceBoardId: number;
  let bobBoardId: number;
  let aliceColumnId: number;
  let bobColumnId: number;
  let aliceWorkspaceId: string;

  beforeAll(async () => {
    alice = await createUser("alice");
    bob = await createUser("bob");
    viewer = await createUser("viewer");

    const aliceWorkspace = await ensurePersonalWorkspace(alice, "Alice");
    aliceWorkspaceId = aliceWorkspace.id;
    await ensurePersonalWorkspace(bob, "Bob");

    aliceBoardId = (await getDefaultBoard(alice))!.id;
    bobBoardId = (await getDefaultBoard(bob))!.id;

    aliceColumnId = (await getBoard(alice, aliceBoardId))!.columns[0].id;
    bobColumnId = (await getBoard(bob, bobBoardId))!.columns[0].id;

    await addMember(alice, aliceWorkspaceId, viewer, "viewer");
  });

  afterAll(async () => {
    // workspace_member cascades from "user", but workspace does not — delete it
    // explicitly, which cascades down through board -> board_column -> task.
    const ids = [alice, bob, viewer];
    await query(
      `DELETE FROM workspace w
        WHERE EXISTS (SELECT 1 FROM workspace_member m
                       WHERE m.workspace_id = w.id AND m.user_id = ANY($1))`,
      [ids]
    );
    await query(`DELETE FROM "user" WHERE id = ANY($1)`, [ids]);
    await pool.end();
  });

  it("gives each user their own workspace and board", async () => {
    expect(aliceBoardId).not.toBe(bobBoardId);
    const aliceWorkspaces = await listWorkspacesForUser(alice);
    expect(aliceWorkspaces).toHaveLength(1);
    expect(aliceWorkspaces[0].role).toBe("owner");
  });

  it("does not list another workspace's boards", async () => {
    const boards = await listBoards(alice, aliceWorkspaceId);
    expect(boards.map((b) => b.id)).not.toContain(bobBoardId);
  });

  describe("createWorkspace", () => {
    it("provisions a workspace the caller owns, with a board and columns", async () => {
      const { workspace, board } = await createWorkspace(bob, "Bob's Second");
      expect(workspace.role).toBe("owner");
      expect(board.workspaceId).toBe(workspace.id);

      // The returned board must be real and reachable — it is what the UI
      // navigates to immediately after creation.
      const data = await getBoard(bob, board.id);
      expect(data?.columns).toHaveLength(3);
    });

    it("does not make the new workspace visible to anyone else", async () => {
      const { workspace } = await createWorkspace(bob, "Bob's Private");
      await expectAuthzError(() => listBoards(alice, workspace.id), "not_found");
    });

    it("leaves the caller's existing workspaces alone", async () => {
      const before = await listWorkspacesForUser(bob);
      await createWorkspace(bob, "Another");
      const after = await listWorkspacesForUser(bob);
      expect(after).toHaveLength(before.length + 1);
    });
  });

  describe("listBoardsForUser", () => {
    it("returns boards from every workspace the user belongs to", async () => {
      const { board } = await createWorkspace(alice, "Alice Extra");
      const ids = (await listBoardsForUser(alice)).map((b) => b.id);
      expect(ids).toContain(aliceBoardId);
      expect(ids).toContain(board.id);
    });

    it("never returns another workspace's boards", async () => {
      // This is the switcher's whole data source, so a leak here would render
      // someone else's board names in the menu.
      const ids = (await listBoardsForUser(bob)).map((b) => b.id);
      expect(ids).not.toContain(aliceBoardId);
    });

    it("includes boards of a workspace the user was added to", async () => {
      const ids = (await listBoardsForUser(viewer)).map((b) => b.id);
      expect(ids).toContain(aliceBoardId);
    });
  });

  describe("cross-tenant reads", () => {
    it("hides another workspace's board as not_found, never forbidden", async () => {
      // 404 rather than 403: a 403 would confirm the id is real, letting a
      // stranger enumerate the id space.
      await expectAuthzError(() => getBoard(bob, aliceBoardId), "not_found");
    });

    it("refuses to read a task in another workspace", async () => {
      const task = await createTask(alice, {
        columnId: aliceColumnId,
        title: "Alice private",
      });
      await expectAuthzError(() => getTask(bob, task.id), "not_found");
    });

    it("refuses to read another workspace's workspace row", async () => {
      const bobWorkspaces = await listWorkspacesForUser(bob);
      await expectAuthzError(
        () => listBoards(alice, bobWorkspaces[0].id),
        "not_found"
      );
    });
  });

  describe("cross-tenant writes", () => {
    it("refuses to create a task in another workspace's column", async () => {
      await expectAuthzError(
        () => createTask(bob, { columnId: aliceColumnId, title: "intruder" }),
        "not_found"
      );
    });

    it("refuses to update, move, or delete another workspace's task", async () => {
      const task = await createTask(alice, {
        columnId: aliceColumnId,
        title: "Alice only",
      });
      await expectAuthzError(
        () => updateTask(bob, task.id, { title: "hijacked" }),
        "not_found"
      );
      await expectAuthzError(
        () => moveTask(bob, task.id, { columnId: bobColumnId, position: 0 }),
        "not_found"
      );
      await expectAuthzError(() => deleteTask(bob, task.id), "not_found");

      // And the task is untouched.
      const after = await getTask(alice, task.id);
      expect(after?.title).toBe("Alice only");
    });

    it("refuses to move a task into another workspace's column", async () => {
      const task = await createTask(alice, {
        columnId: aliceColumnId,
        title: "stays home",
      });
      // Alice may touch her own task, and bobColumnId is not hers — the target
      // check must reject before any position rewriting happens.
      await expectAuthzError(
        () => moveTask(alice, task.id, { columnId: bobColumnId, position: 0 }),
        "not_found"
      );
    });

    it("refuses to move a task across boards inside one workspace", async () => {
      const second = await createBoard(alice, aliceWorkspaceId, "Second Board");
      const secondColumnId = (await getBoard(alice, second.id))!.columns[0].id;
      const task = await createTask(alice, {
        columnId: aliceColumnId,
        title: "board-bound",
      });
      // Alice passes both role checks here, so only the same-board assertion
      // stops this one.
      await expectAuthzError(
        () => moveTask(alice, task.id, { columnId: secondColumnId, position: 0 }),
        "forbidden"
      );
    });
  });

  describe("viewer role", () => {
    it("can read the board", async () => {
      const data = await getBoard(viewer, aliceBoardId);
      expect(data?.board.id).toBe(aliceBoardId);
    });

    it("cannot create, update, move, or delete tasks", async () => {
      // "forbidden", not "not_found": the viewer is a member and can already
      // see this board, so naming the reason leaks nothing.
      await expectAuthzError(
        () => createTask(viewer, { columnId: aliceColumnId, title: "nope" }),
        "forbidden"
      );

      const task = await createTask(alice, {
        columnId: aliceColumnId,
        title: "read only",
      });
      await expectAuthzError(
        () => updateTask(viewer, task.id, { title: "nope" }),
        "forbidden"
      );
      await expectAuthzError(
        () => moveTask(viewer, task.id, { columnId: aliceColumnId, position: 0 }),
        "forbidden"
      );
      await expectAuthzError(() => deleteTask(viewer, task.id), "forbidden");
    });

    it("cannot create a board (requires admin)", async () => {
      await expectAuthzError(
        () => createBoard(viewer, aliceWorkspaceId, "nope"),
        "forbidden"
      );
    });
  });

  describe("owner permissions still work", () => {
    it("creates, moves, and deletes tasks on their own board", async () => {
      const data = await getBoard(alice, aliceBoardId);
      const [todo, inProgress] = data!.columns;

      const task = await createTask(alice, {
        columnId: todo.id,
        title: "Drag me",
      });
      const moved = await moveTask(alice, task.id, {
        columnId: inProgress.id,
        position: 0,
      });
      expect(moved?.columnId).toBe(inProgress.id);
      expect(moved?.position).toBe(0);

      const renamed = await updateTask(alice, task.id, { title: "Dragged" });
      expect(renamed?.title).toBe("Dragged");
      // COALESCE must not wipe the field the caller left out.
      expect(renamed?.description).toBe("");

      expect(await deleteTask(alice, task.id)).toBe(true);
    });
  });
});
