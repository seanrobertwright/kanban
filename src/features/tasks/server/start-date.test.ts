import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getBoard } from "@/features/board/server/repository";
import {
  ensurePersonalWorkspace,
  getDefaultBoard,
} from "@/features/workspaces/server/repository";
import { pool, query, queryOne } from "@/shared/db/client";
import { createTask, updateTask } from "./repository";

/**
 * Against a real Postgres, because 032's semantics are database semantics: the
 * DATE round-trips through shared/db/client.ts as a 'YYYY-MM-DD' string (never a
 * Date), and the supplied-flag idiom that tells "clear the start date" from
 * "leave it alone" is SQL a mock would misread. The clear-vs-leave distinction —
 * dueDate's rule, one field over — is the thing worth holding to.
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

describe("task start date", () => {
  let alice: string;
  let boardId: number;
  let columnId: number;

  beforeAll(async () => {
    alice = await createUser("sd-alice");
    await ensurePersonalWorkspace(alice, "SdAlice");
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

  it("defaults to no start date", async () => {
    const task = await createTask(alice, { columnId, title: "Undated" });
    expect(task.startDate).toBeNull();
  });

  it("creates with a start date as a 'YYYY-MM-DD' string and reads it back", async () => {
    const task = await createTask(alice, {
      columnId,
      title: "Kickoff Monday",
      startDate: "2026-03-02",
      dueDate: "2026-03-13",
    });
    // A string, not a Date — the one boundary where a zoneless date would drift.
    expect(task.startDate).toBe("2026-03-02");
    expect(task.dueDate).toBe("2026-03-13");
  });

  it("rides under task.updated, with the snapshot carrying the new date", async () => {
    const task = await createTask(alice, { columnId, title: "Schedule me" });

    const scheduled = await updateTask(alice, task.id, {
      startDate: "2026-04-01",
    });
    expect(scheduled!.startDate).toBe("2026-04-01");

    // 032 rides under task.updated (every field added since dueDate does), not a
    // task.scheduled of its own — one row, snapshot carrying the date for undo.
    const row = await queryOne<{ after: { startDate: string } }>(
      `SELECT after FROM activity_log
        WHERE task_id = $1 AND action = 'task.updated'
        ORDER BY id DESC LIMIT 1`,
      [task.id]
    );
    expect(row!.after.startDate).toBe("2026-04-01");
  });

  it("clears a start date with null, and leaves it alone when absent", async () => {
    const task = await createTask(alice, {
      columnId,
      title: "Started",
      startDate: "2026-05-05",
    });

    // A title-only edit says nothing about the start date — it must survive.
    const renamed = await updateTask(alice, task.id, { title: "Renamed" });
    expect(renamed!.startDate).toBe("2026-05-05");

    // null is the cleared state, not "not supplied" — dueDate's rule (032).
    const cleared = await updateTask(alice, task.id, { startDate: null });
    expect(cleared!.startDate).toBeNull();
  });

  it("a no-op edit logs nothing", async () => {
    const task = await createTask(alice, {
      columnId,
      title: "Quiet",
      startDate: "2026-06-06",
    });
    await updateTask(alice, task.id, { startDate: "2026-06-06" });

    const { rows } = await pool.query(
      `SELECT 1 FROM activity_log WHERE task_id = $1 AND action = 'task.updated'`,
      [task.id]
    );
    expect(rows).toHaveLength(0);
  });
});
