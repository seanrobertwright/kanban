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
  createField,
  deleteField,
  getTaskFields,
  listBoardFields,
  setTaskFieldValues,
} from "./repository";

/**
 * Against a real Postgres: the value store is TEXT interpreted by type, and the
 * type coercion (a select must be an option, a number must parse) plus the two
 * CASCADEs are database facts a mock cannot stand in for (035).
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

describe("custom fields", () => {
  let alice: string;
  let boardId: number;
  let columnId: number;

  beforeAll(async () => {
    alice = await createUser("cf-alice");
    await ensurePersonalWorkspace(alice, "CfAlice");
    boardId = (await getDefaultBoard(alice))!.id;
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

  it("creates fields and lists them in order", async () => {
    const text = await createField(alice, boardId, { name: "Account", type: "text" });
    const select = await createField(alice, boardId, {
      name: "Impact",
      type: "select",
      options: ["Low", "High"],
    });
    expect(text.options).toEqual([]);
    expect(select.options).toEqual(["Low", "High"]);

    const fields = await listBoardFields(alice, boardId);
    expect(fields.map((f) => f.name)).toContain("Account");
    expect(fields.map((f) => f.name)).toContain("Impact");
  });

  it("refuses a select with no options", async () => {
    await expect(
      createField(alice, boardId, { name: "Empty select", type: "select" })
    ).rejects.toMatchObject({ kind: "conflict" });
  });

  it("sets and reads a task's answers, coercing by type", async () => {
    const account = await createField(alice, boardId, { name: "Team", type: "text" });
    const size = await createField(alice, boardId, { name: "Size", type: "number" });
    const task = (await createTask(alice, { columnId, title: "Answer me" })).id;

    await setTaskFieldValues(alice, task, [
      { fieldId: account.id, value: "Platform" },
      { fieldId: size.id, value: "42" },
    ]);

    const answered = await getTaskFields(alice, task);
    expect(answered.find((f) => f.id === account.id)?.value).toBe("Platform");
    expect(answered.find((f) => f.id === size.id)?.value).toBe("42");
  });

  it("rejects a value that does not fit its field's type", async () => {
    const size = await createField(alice, boardId, { name: "Count", type: "number" });
    const task = (await createTask(alice, { columnId, title: "Bad value" })).id;
    await expect(
      setTaskFieldValues(alice, task, [{ fieldId: size.id, value: "not a number" }])
    ).rejects.toMatchObject({ kind: "conflict" });
  });

  it("rejects an option a select field does not offer", async () => {
    const pri = await createField(alice, boardId, {
      name: "Tier",
      type: "select",
      options: ["A", "B"],
    });
    const task = (await createTask(alice, { columnId, title: "Bad option" })).id;
    await expect(
      setTaskFieldValues(alice, task, [{ fieldId: pri.id, value: "C" }])
    ).rejects.toMatchObject({ kind: "conflict" });
  });

  it("clears an answer when set to null", async () => {
    const note = await createField(alice, boardId, { name: "Note", type: "text" });
    const task = (await createTask(alice, { columnId, title: "Clearable" })).id;
    await setTaskFieldValues(alice, task, [{ fieldId: note.id, value: "hi" }]);
    await setTaskFieldValues(alice, task, [{ fieldId: note.id, value: null }]);
    const fields = await getTaskFields(alice, task);
    expect(fields.find((f) => f.id === note.id)?.value).toBeNull();
  });

  it("refuses a field id from off this task's board (not_found)", async () => {
    const task = (await createTask(alice, { columnId, title: "Tenancy" })).id;
    await expect(
      setTaskFieldValues(alice, task, [{ fieldId: 9_999_999, value: "x" }])
    ).rejects.toMatchObject({ kind: "not_found" });
  });

  it("deleting a field cascades its values away", async () => {
    const doomed = await createField(alice, boardId, { name: "Doomed", type: "text" });
    const task = (await createTask(alice, { columnId, title: "Cascade" })).id;
    await setTaskFieldValues(alice, task, [{ fieldId: doomed.id, value: "here" }]);

    await deleteField(alice, doomed.id);

    // The field is gone from the board, and its value went with it.
    const fields = await listBoardFields(alice, boardId);
    expect(fields.some((f) => f.id === doomed.id)).toBe(false);
    const { rows } = await pool.query(
      `SELECT 1 FROM custom_field_value WHERE field_id = $1`,
      [doomed.id]
    );
    expect(rows).toHaveLength(0);
  });

  it("surfaces a task's answers on the board read for cards (036)", async () => {
    // The values follow-up: taskColumns now carries {fieldId, value} per task,
    // and BoardData carries the definitions, so a card can render both without
    // its own fetch.
    const field = await createField(alice, boardId, {
      name: "Region",
      type: "text",
    });
    const task = await createTask(alice, { columnId, title: "On a card" });
    await setTaskFieldValues(alice, task.id, [
      { fieldId: field.id, value: "EU" },
    ]);

    const board = await getBoard(alice, boardId);
    const read = board!.tasks.find((t) => t.id === task.id);

    expect(read!.customFields).toContainEqual({
      fieldId: field.id,
      value: "EU",
    });
    // The definition rides on BoardData so the card can resolve the name + type.
    expect(board!.customFields.some((f) => f.id === field.id)).toBe(true);
  });
});
