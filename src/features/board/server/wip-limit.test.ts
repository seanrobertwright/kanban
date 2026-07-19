import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  ensurePersonalWorkspace,
  getDefaultBoard,
} from "@/features/workspaces/server/repository";
import { pool, query, queryOne } from "@/shared/db/client";
import { getBoard } from "./repository";
import { setColumnWipLimit } from "./columns";

/**
 * Against a real Postgres for 023's two database facts: the CHECK refuses a
 * non-positive limit, and NULL round-trips as "no limit" rather than 0 — the
 * distinction the header's "4/3" rendering rests on.
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

describe("WIP limits", () => {
  let alice: string;
  let boardId: number;
  let columnId: number;

  beforeAll(async () => {
    alice = await createUser("wip-alice");
    await ensurePersonalWorkspace(alice, "WipAlice");
    const board = (await getDefaultBoard(alice))!;
    boardId = board.id;
    columnId = (await getBoard(alice, boardId))!.columns[0].id;
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

  it("sets, reads back, and clears a limit, logging each change", async () => {
    const limited = await setColumnWipLimit(alice, columnId, 3);
    expect(limited!.wipLimit).toBe(3);

    // The board read carries it — the header renders from getBoard, not from
    // the mutation's return.
    const board = (await getBoard(alice, boardId))!;
    expect(board.columns.find((c) => c.id === columnId)!.wipLimit).toBe(3);

    const cleared = await setColumnWipLimit(alice, columnId, null);
    expect(cleared!.wipLimit).toBeNull();

    // Both changes logged as column.updated, snapshots carrying the limit.
    const row = await queryOne<{
      before: { wipLimit: number | null };
      after: { wipLimit: number | null };
    }>(
      `SELECT before, after FROM activity_log
        WHERE board_id = $1 AND action = 'column.updated'
        ORDER BY id DESC LIMIT 1`,
      [boardId]
    );
    expect(row!.before.wipLimit).toBe(3);
    expect(row!.after.wipLimit).toBeNull();
  });

  it("a no-op set logs nothing and returns the column", async () => {
    await setColumnWipLimit(alice, columnId, 5);
    const { rows: preRows } = await pool.query(
      `SELECT COUNT(*)::int AS count FROM activity_log
        WHERE board_id = $1 AND action = 'column.updated'`,
      [boardId]
    );
    const again = await setColumnWipLimit(alice, columnId, 5);
    expect(again!.wipLimit).toBe(5);

    const { rows: postRows } = await pool.query(
      `SELECT COUNT(*)::int AS count FROM activity_log
        WHERE board_id = $1 AND action = 'column.updated'`,
      [boardId]
    );
    expect(postRows[0].count).toBe(preRows[0].count);
  });

  it("the database refuses a non-positive limit", async () => {
    await expect(
      pool.query(`UPDATE board_column SET wip_limit = 0 WHERE id = $1`, [
        columnId,
      ])
    ).rejects.toThrow(/check/i);
  });
});
