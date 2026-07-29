import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  ensurePersonalWorkspace,
  getDefaultBoard,
} from "@/features/workspaces/server/repository";
import { pool, query } from "@/shared/db/client";
import {
  createWhiteboard,
  listWhiteboards,
  updateWhiteboard,
} from "./repository";

/**
 * Whiteboards (060) against a real Postgres, because everything worth proving
 * about this slice is a database fact: the scene is JSONB (so it must survive a
 * round trip unchanged, not merely "be truthy"), the title has a CHECK, and the
 * board role is what separates a reader from an editor.
 */

const users: string[] = [];

async function createUser(label: string): Promise<string> {
  const id = `test-wb-${label}-${randomUUID()}`;
  await query(
    `INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, true)`,
    [id, `Test ${label}`, `${id}@example.test`]
  );
  users.push(id);
  return id;
}

describe("whiteboards (db)", () => {
  let alice: string;
  let viewer: string;
  let outsider: string;
  let workspaceId: string;
  let boardId: number;

  beforeAll(async () => {
    alice = await createUser("alice");
    viewer = await createUser("viewer");
    outsider = await createUser("outsider");
    workspaceId = (await ensurePersonalWorkspace(alice, "Alice")).id;
    boardId = (await getDefaultBoard(alice))!.id;
    await query(
      `INSERT INTO workspace_member (workspace_id, user_id, role) VALUES ($1, $2, 'viewer')`,
      [workspaceId, viewer]
    );
    await ensurePersonalWorkspace(outsider, "Outsider");
  });

  afterAll(async () => {
    await query(
      `DELETE FROM workspace w WHERE EXISTS (
         SELECT 1 FROM workspace_member m
          WHERE m.workspace_id = w.id AND m.user_id = ANY($1))`,
      [users]
    );
    await query(`DELETE FROM "user" WHERE id = ANY($1)`, [users]);
    await pool.end();
  });

  it("persists a canvas scene verbatim and starts empty", async () => {
    const board = await createWhiteboard(alice, boardId, "Retro");
    // A new canvas is [] rather than null — the client renders a scene array
    // and would have to special-case a null on every load.
    expect(board.scene).toEqual([]);

    // Nested objects, numbers and unicode all ride JSONB; the point is that the
    // repository stores the scene rather than interpreting it, so a shape it
    // has never seen must come back byte-for-byte.
    const scene = [
      { id: "n1", type: "rect", x: 1.5, y: -2, points: [[0, 0], [3, 4]] },
      { id: "n2", type: "text", text: "Ship it → 🚢", style: { bold: true } },
    ];
    const saved = await updateWhiteboard(alice, board.id, scene);
    expect(saved.scene).toEqual(scene);
    expect((await listWhiteboards(alice, boardId)).find((w) => w.id === board.id)!.scene)
      .toEqual(scene);
  });

  it("replaces the scene wholesale and advances updated_at", async () => {
    const board = await createWhiteboard(alice, boardId, "Sequence");
    await updateWhiteboard(alice, board.id, [{ id: "a" }, { id: "b" }]);
    const second = await updateWhiteboard(alice, board.id, [{ id: "c" }]);

    // Not a merge: the canvas the client sends IS the canvas. A deleted shape
    // stays deleted, which a jsonb concat would silently undo.
    expect(second.scene).toEqual([{ id: "c" }]);
    expect(Date.parse(second.updatedAt)).toBeGreaterThanOrEqual(
      Date.parse(board.updatedAt)
    );
  });

  it("trims the title and refuses a blank one", async () => {
    const board = await createWhiteboard(alice, boardId, "  Spaced  ");
    expect(board.title).toBe("Spaced");
    // The CHECK in 060 is the last word — a title of only whitespace trims to
    // empty and the insert fails rather than creating a nameless canvas.
    await expect(createWhiteboard(alice, boardId, "   ")).rejects.toThrow();
  });

  it("lets a viewer read but not write, and keeps outsiders out entirely", async () => {
    const board = await createWhiteboard(alice, boardId, "Read only");

    // Viewer: a whiteboard is a way of looking at the work, so reading needs no
    // more than viewer — but editing is a member act.
    expect((await listWhiteboards(viewer, boardId)).some((w) => w.id === board.id))
      .toBe(true);
    await expect(createWhiteboard(viewer, boardId, "Nope")).rejects.toThrow();
    await expect(updateWhiteboard(viewer, board.id, [{ id: "x" }])).rejects.toThrow();

    // Outsider: another workspace's owner reaches neither door.
    await expect(listWhiteboards(outsider, boardId)).rejects.toThrow();
    await expect(updateWhiteboard(outsider, board.id, [{ id: "x" }])).rejects.toThrow();
  });

  it("answers not_found for a whiteboard that does not exist", async () => {
    // Resolved before the role check, so the id space cannot be probed by
    // comparing a 403 against a 404.
    await expect(updateWhiteboard(alice, 2_000_000_000, [])).rejects.toThrow(
      /not found/i
    );
  });

  it("lists a board's whiteboards oldest first, and only that board's", async () => {
    const otherBoard = await query<{ id: number }>(
      `INSERT INTO board (workspace_id, name, position) VALUES ($1, 'Second board', 1) RETURNING id`,
      [workspaceId]
    );
    const mine = await createWhiteboard(alice, boardId, "Ordering A");
    const later = await createWhiteboard(alice, boardId, "Ordering B");
    const elsewhere = await createWhiteboard(alice, otherBoard[0].id, "Elsewhere");

    const listed = await listWhiteboards(alice, boardId);
    const ids = listed.map((w) => w.id);
    expect(ids.indexOf(mine.id)).toBeLessThan(ids.indexOf(later.id));
    expect(ids).not.toContain(elsewhere.id);
  });
});
