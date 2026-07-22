import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getBoard } from "@/features/board/server/repository";
import {
  ensurePersonalWorkspace,
  getDefaultBoard,
} from "@/features/workspaces/server/repository";
import { getTask } from "@/features/tasks/server/repository";
import { pool, query } from "@/shared/db/client";
import { resolveRouting, type FormField, type FormRoute } from "../types";
import { createForm, submitForm } from "./repository";

/**
 * Forms routing (048, rock 1.7): a submission's answers pick the target column /
 * assignee / labels. resolveRouting is pure; the DB test proves submitForm honors
 * the first matching route and falls back to the form's default otherwise.
 */

describe("resolveRouting (pure)", () => {
  const fields: FormField[] = [
    { label: "Summary", type: "text", required: true },
    { label: "Severity", type: "text", required: false },
  ];
  const routes: FormRoute[] = [
    { conditions: { field: "Severity", op: "eq", value: "high" }, columnId: 42, labelIds: [7] },
  ];

  it("returns the matching route's overrides", () => {
    expect(resolveRouting(routes, fields, ["Login broken", "high"])).toEqual({
      columnId: 42,
      labelIds: [7],
    });
  });
  it("returns nothing when no route matches", () => {
    expect(resolveRouting(routes, fields, ["Login broken", "low"])).toEqual({});
  });
});

const createdUsers: string[] = [];
async function createUser(label: string): Promise<string> {
  const id = `test-${label}-${randomUUID()}`;
  await query(
    `INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, true)`,
    [id, `Test ${label}`, `${id}@example.test`]
  );
  createdUsers.push(id);
  return id;
}

describe("forms routing (db)", () => {
  let alice: string;
  let boardId: number;
  let col1: number;
  let col2: number;
  let col3: number;

  beforeAll(async () => {
    alice = await createUser("route-alice");
    await ensurePersonalWorkspace(alice, "RouteAlice");
    boardId = (await getDefaultBoard(alice))!.id;
    const cols = (await getBoard(alice, boardId))!.columns;
    [col1, col2, col3] = [cols[0].id, cols[1].id, cols[2].id];
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

  it("routes a high-severity submission to a different column", async () => {
    const form = await createForm(alice, boardId, {
      name: "Bug report",
      targetColumnId: col1, // default lands here
      fields: [
        { label: "Summary", type: "text", required: true },
        { label: "Severity", type: "text", required: false },
      ],
      routing: [
        { conditions: { field: "Severity", op: "eq", value: "high" }, columnId: col3 },
      ],
    });

    const urgent = await submitForm(alice, form.id, {
      answers: ["Prod down", "high"],
    });
    expect((await getTask(alice, urgent.id))!.columnId).toBe(col3);

    // A non-matching submission lands in the default column.
    const normal = await submitForm(alice, form.id, {
      answers: ["Typo", "low"],
    });
    expect((await getTask(alice, normal.id))!.columnId).toBe(col1);
    expect(col2).toBeGreaterThan(0); // silence unused
  });
});
