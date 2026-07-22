import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createBoard,
  ensurePersonalWorkspace,
  getDefaultBoard,
  listWorkspacesForUser,
} from "@/features/workspaces/server/repository";
import { pool, query } from "@/shared/db/client";
import {
  createProgram,
  deleteProgram,
  getWorkspacePrograms,
  setBoardProgram,
  updateProgram,
} from "./repository";

/**
 * The grouping arithmetic is unit-tested pure; the database facts here are the
 * workspace scoping, the board→program assignment and its cross-workspace guard,
 * and the SET NULL un-grouping on delete (040).
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

describe("programs", () => {
  let alice: string;
  let workspaceId: string;
  let boardA: number;
  let boardB: number;

  beforeAll(async () => {
    alice = await createUser("prog-alice");
    await ensurePersonalWorkspace(alice, "ProgAlice");
    workspaceId = (await listWorkspacesForUser(alice))[0].id;
    boardA = (await getDefaultBoard(alice))!.id;
    boardB = (await createBoard(alice, workspaceId, "Second")).id;
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

  it("creates a program and files boards under it", async () => {
    const program = await createProgram(alice, workspaceId, { name: "Platform" });
    await setBoardProgram(alice, boardA, program.id);
    await setBoardProgram(alice, boardB, program.id);

    const { groups } = await getWorkspacePrograms(alice, workspaceId);
    const platform = groups.find((g) => g.program?.id === program.id)!;
    expect(platform.boards).toHaveLength(2);
    expect(platform.totals.boards).toBe(2);
    // No board is left unassigned now.
    expect(groups.some((g) => g.program === null)).toBe(false);
  });

  it("renames a program and clears a board's assignment", async () => {
    const program = await createProgram(alice, workspaceId, { name: "Temp" });
    const renamed = await updateProgram(alice, program.id, { name: "Renamed" });
    expect(renamed?.name).toBe("Renamed");

    await setBoardProgram(alice, boardB, program.id);
    await setBoardProgram(alice, boardB, null);
    const { groups } = await getWorkspacePrograms(alice, workspaceId);
    const temp = groups.find((g) => g.program?.id === program.id)!;
    expect(temp.boards).toHaveLength(0);
    // boardB is back in the Unassigned bucket.
    expect(groups.some((g) => g.program === null)).toBe(true);
  });

  it("un-groups boards on delete (SET NULL), never removing the board", async () => {
    const program = await createProgram(alice, workspaceId, { name: "Doomed" });
    await setBoardProgram(alice, boardA, program.id);
    await deleteProgram(alice, program.id);

    const { groups } = await getWorkspacePrograms(alice, workspaceId);
    expect(groups.some((g) => g.program?.id === program.id)).toBe(false);
    // boardA survives, now unassigned.
    const unassigned = groups.find((g) => g.program === null)!;
    expect(unassigned.boards.some((b) => b.id === boardA)).toBe(true);
  });

  it("refuses filing a board under another workspace's program (not_found)", async () => {
    const bob = await createUser("prog-bob");
    await ensurePersonalWorkspace(bob, "ProgBob");
    const bobWs = (await listWorkspacesForUser(bob))[0].id;
    const bobProgram = await createProgram(bob, bobWs, { name: "Foreign" });

    await expect(
      setBoardProgram(alice, boardA, bobProgram.id)
    ).rejects.toMatchObject({ kind: "not_found" });
  });
});
