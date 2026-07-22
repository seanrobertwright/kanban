import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AuthzError } from "@/features/workspaces/server/authz";
import {
  ensurePersonalWorkspace,
  getDefaultBoard,
  listWorkspacesForUser,
} from "@/features/workspaces/server/repository";
import { pool, query } from "@/shared/db/client";
import {
  addTeamMember,
  createTeam,
  deleteTeam,
  getScaledAgileOverview,
  removeTeamMember,
  setBoardTeam,
} from "./repository";

/**
 * The layer-cake composition is unit-tested pure; the database facts here are the
 * workspace-member guard on the roster, the same-workspace guard on board→team,
 * the SET-NULL of a board when its team is deleted, and the overview shape (044).
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

describe("teams / scaled agile", () => {
  let alice: string;
  let stranger: string;
  let workspaceId: string;
  let boardId: number;

  beforeAll(async () => {
    alice = await createUser("team-alice");
    stranger = await createUser("team-stranger");
    await ensurePersonalWorkspace(alice, "TeamAlice");
    await ensurePersonalWorkspace(stranger, "Stranger");
    workspaceId = (await listWorkspacesForUser(alice))[0].id;
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

  it("rosters a workspace member but refuses a stranger", async () => {
    const team = await createTeam(alice, workspaceId, { name: "Alpha" });
    await addTeamMember(alice, team.id, alice);
    // Idempotent — a second add is a no-op, not an error.
    await addTeamMember(alice, team.id, alice);

    await expect(addTeamMember(alice, team.id, stranger)).rejects.toBeInstanceOf(
      AuthzError
    );

    const overview = await getScaledAgileOverview(alice, workspaceId);
    const alpha = overview.teams.find((t) => t.id === team.id)!;
    expect(alpha.members).toHaveLength(1);
    expect(alpha.members[0].userId).toBe(alice);

    await removeTeamMember(alice, team.id, alice);
    const after = await getScaledAgileOverview(alice, workspaceId);
    expect(after.teams.find((t) => t.id === team.id)!.members).toHaveLength(0);
  });

  it("owns a board with a same-workspace team and un-owns on delete", async () => {
    const team = await createTeam(alice, workspaceId, { name: "Owns" });
    await setBoardTeam(alice, boardId, team.id);

    let overview = await getScaledAgileOverview(alice, workspaceId);
    let row = overview.arts.flatMap((g) => g.boards).find((b) => b.id === boardId)!;
    expect(row.teamId).toBe(team.id);
    expect(row.teamName).toBe("Owns");

    // Deleting the team SET-NULLs the board's team_id, it does not remove the board.
    await deleteTeam(alice, team.id);
    overview = await getScaledAgileOverview(alice, workspaceId);
    row = overview.arts.flatMap((g) => g.boards).find((b) => b.id === boardId)!;
    expect(row.teamId).toBeNull();
    expect(row.teamName).toBeNull();
  });

  it("refuses to hand a board to another workspace's team", async () => {
    const strangerWs = (await listWorkspacesForUser(stranger))[0].id;
    const foreign = await createTeam(stranger, strangerWs, { name: "Foreign" });
    await expect(setBoardTeam(alice, boardId, foreign.id)).rejects.toBeInstanceOf(
      AuthzError
    );
  });
});
