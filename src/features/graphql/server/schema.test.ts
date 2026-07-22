import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getBoard } from "@/features/board/server/repository";
import {
  ensurePersonalWorkspace,
  getDefaultBoard,
} from "@/features/workspaces/server/repository";
import { pool, query } from "@/shared/db/client";
import { createTask } from "@/features/tasks/server/repository";
import { executeGraphQL } from "./schema";

/**
 * GraphQL API (2.9): a read-first shape over the repositories. The query returns
 * the board tree; authz is inherited from getBoard/getTask, so a principal that
 * cannot read a board gets an error + null field, never another board's data.
 */

describe("executeGraphQL (db)", () => {
  const createdUsers: string[] = [];
  let alice: string;
  let boardId: number;
  let startCol: number;
  let taskId: number;

  beforeAll(async () => {
    alice = `test-gql-alice-${randomUUID()}`;
    await query(
      `INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, true)`,
      [alice, "Grace QL", `${alice}@example.test`]
    );
    createdUsers.push(alice);
    await ensurePersonalWorkspace(alice, "GqlAlice");
    const board = (await getDefaultBoard(alice))!;
    boardId = board.id;
    startCol = (await getBoard(alice, boardId))!.columns[0].id;
    taskId = (await createTask(alice, { columnId: startCol, title: "Query me" })).id;
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

  it("returns the board tree with its columns and tasks", async () => {
    const result = await executeGraphQL(
      alice,
      `query ($id: Int!) {
        board(id: $id) {
          id
          name
          columns { id title tasks { id title columnId } }
        }
      }`,
      { id: boardId }
    );
    expect(result.errors).toBeUndefined();
    const board = (result.data as { board: { id: number; columns: { id: number; tasks: { id: number; title: string }[] }[] } }).board;
    expect(board.id).toBe(boardId);
    const col = board.columns.find((c) => c.id === startCol)!;
    expect(col.tasks.some((t) => t.id === taskId && t.title === "Query me")).toBe(true);
  });

  it("resolves a single task by id", async () => {
    const result = await executeGraphQL(
      alice,
      `query ($id: Int!) { task(id: $id) { id title } }`,
      { id: taskId }
    );
    expect(result.errors).toBeUndefined();
    expect((result.data as { task: { title: string } }).task.title).toBe("Query me");
  });

  it("inherits authz — a non-member cannot read the board", async () => {
    const bob = `test-gql-bob-${randomUUID()}`;
    await query(
      `INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, true)`,
      [bob, "Bob Outsider", `${bob}@example.test`]
    );
    createdUsers.push(bob);
    await ensurePersonalWorkspace(bob, "GqlBob");

    const result = await executeGraphQL(
      bob,
      `query ($id: Int!) { board(id: $id) { id name } }`,
      { id: boardId }
    );
    // The repository's authz throws → GraphQL surfaces an error and a null field,
    // never Alice's board.
    expect(result.errors).toBeTruthy();
    expect((result.data as { board: unknown } | null | undefined)?.board ?? null).toBeNull();
  });
});
