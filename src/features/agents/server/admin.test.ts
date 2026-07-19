import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getBoard } from "@/features/board/server/repository";
import { createTask } from "@/features/tasks/server/repository";
import {
  ensurePersonalWorkspace,
  getDefaultBoard,
} from "@/features/workspaces/server/repository";
import { getAgentByToken } from "@/features/auth/server/agent-auth";
import { pool, query, queryOne } from "@/shared/db/client";
import { createAgent, deleteAgent, listAgents } from "./admin";
import { getBudget, getBudgetFor, setBudget } from "./budget";

/**
 * The agent-management surface against a real Postgres — the human, admin-side of
 * M2 the CLI (create-agent.mjs) used to be the only door to. Proves the token
 * contract (minted once, only the hash stored), the escalation guard (an admin
 * cannot mint an owner), the delete cleanup (a stranded claim freed and an
 * assignment unassigned, both logged), the active-run refusal, and the budget cap.
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

describe("agent management", () => {
  let owner: string;
  let admin: string;
  let viewer: string;
  let ws: string;
  let todo: number;

  beforeAll(async () => {
    owner = await createUser("adm-owner");
    await ensurePersonalWorkspace(owner, "AdminWs");
    const boardId = (await getDefaultBoard(owner))!.id;
    ws = (await queryOne<{ w: string }>(
      `SELECT workspace_id AS w FROM board WHERE id = $1`,
      [boardId]
    ))!.w;
    todo = (await getBoard(owner, boardId))!.columns[0].id;

    admin = await createUser("adm-admin");
    viewer = await createUser("adm-viewer");
    await query(
      `INSERT INTO workspace_member (workspace_id, user_id, role) VALUES ($1, $2, 'admin')`,
      [ws, admin]
    );
    await query(
      `INSERT INTO workspace_member (workspace_id, user_id, role) VALUES ($1, $2, 'viewer')`,
      [ws, viewer]
    );
  });

  afterAll(async () => {
    await query(`DELETE FROM workspace WHERE id = $1`, [ws]);
    await query(`DELETE FROM "user" WHERE id = ANY($1)`, [[owner, admin, viewer]]);
    await pool.end();
  });

  it("mints an external agent with a one-time token, storing only its hash", async () => {
    const { agent, token } = await createAgent(owner, ws, {
      name: "Ext Bot",
      role: "member",
      kind: "external",
    });
    expect(token).toMatch(/^kbn_/);
    expect(agent.kind).toBe("external");
    expect(agent.model).toBeNull();

    // The token resolves to this agent — the auth path is wired to what we stored.
    const principal = await getAgentByToken(token!);
    expect(principal?.agentId).toBe(agent.id);

    // Only the hash is in the row; the raw token is nowhere in the database.
    const row = await queryOne<{ token_hash: string }>(
      `SELECT token_hash FROM agent WHERE id = $1`,
      [agent.id]
    );
    expect(row!.token_hash).toHaveLength(64);
    expect(row!.token_hash).not.toBe(token);

    // The list read never carries a token — only a hash exists to give.
    const listed = await listAgents(owner, ws);
    expect(listed.some((a) => a.id === agent.id)).toBe(true);
    expect(listed.every((a) => !("token" in a))).toBe(true);
  });

  it("mints a native agent with a model and no token", async () => {
    const { agent, token } = await createAgent(owner, ws, {
      name: "Native Bot",
      role: "member",
      kind: "native",
      model: "claude-opus-4-8",
    });
    expect(token).toBeUndefined();
    expect(agent.kind).toBe("native");
    expect(agent.model).toBe("claude-opus-4-8");

    const row = await queryOne<{ token_hash: string | null }>(
      `SELECT token_hash FROM agent WHERE id = $1`,
      [agent.id]
    );
    expect(row!.token_hash).toBeNull();
  });

  it("listing and creating are admin-only", async () => {
    await expect(listAgents(viewer, ws)).rejects.toThrow();
    await expect(
      createAgent(viewer, ws, { name: "Nope", role: "member", kind: "external" })
    ).rejects.toThrow();
  });

  it("only an owner can mint an owner agent", async () => {
    await expect(
      createAgent(admin, ws, { name: "Owner Bot", role: "owner", kind: "external" })
    ).rejects.toThrow(/owner/);
    const { agent } = await createAgent(owner, ws, {
      name: "Owner Bot",
      role: "owner",
      kind: "external",
    });
    expect(agent.role).toBe("owner");
  });

  it("deleting an agent frees its claim and unassigns its tasks, each logged", async () => {
    const { agent } = await createAgent(owner, ws, {
      name: "Doomed",
      role: "member",
      kind: "external",
    });
    const assigned = await createTask(owner, { columnId: todo, title: "assigned" });
    const claimed = await createTask(owner, { columnId: todo, title: "claimed" });

    // Set the assignment and the claim directly — the point under test is the
    // cleanup on the way out, not the paths that create them.
    await query(`UPDATE task SET agent_id = $2 WHERE id = $1`, [assigned.id, agent.id]);
    await query(
      `UPDATE task SET claimed_by = $2, claimed_by_type = 'agent', claimed_at = now()
        WHERE id = $1`,
      [claimed.id, agent.id]
    );

    await deleteAgent(owner, ws, agent.id);

    expect(
      await queryOne(`SELECT id FROM agent WHERE id = $1`, [agent.id])
    ).toBeUndefined();

    const assignedRow = await queryOne<{ agent_id: string | null }>(
      `SELECT agent_id FROM task WHERE id = $1`,
      [assigned.id]
    );
    expect(assignedRow!.agent_id).toBeNull();

    const claimedRow = await queryOne<{ claimed_by: string | null }>(
      `SELECT claimed_by FROM task WHERE id = $1`,
      [claimed.id]
    );
    expect(claimedRow!.claimed_by).toBeNull();

    // Each cleanup is attributable to the human who deleted the agent.
    const unassignLog = await queryOne<{ actor_id: string; actor_type: string }>(
      `SELECT actor_id, actor_type FROM activity_log
        WHERE task_id = $1 AND action = 'task.assigned' ORDER BY id DESC LIMIT 1`,
      [assigned.id]
    );
    expect(unassignLog).toMatchObject({ actor_id: owner, actor_type: "human" });
    const releaseLog = await queryOne<{ actor_id: string }>(
      `SELECT actor_id FROM activity_log
        WHERE task_id = $1 AND action = 'task.released' ORDER BY id DESC LIMIT 1`,
      [claimed.id]
    );
    expect(releaseLog!.actor_id).toBe(owner);
  });

  it("refuses to delete an agent with a run in flight, then allows it once settled", async () => {
    const { agent } = await createAgent(owner, ws, {
      name: "Busy",
      role: "member",
      kind: "external",
    });
    const runId = randomUUID();
    await query(
      `INSERT INTO agent_run (id, agent_id, workspace_id, status)
       VALUES ($1, $2, $3, 'awaiting_review')`,
      [runId, agent.id, ws]
    );

    await expect(deleteAgent(owner, ws, agent.id)).rejects.toThrow(/active run/i);

    // Once the run settles to a terminal state, the delete goes through (and the
    // run cascades away with the agent).
    await query(`UPDATE agent_run SET status = 'succeeded' WHERE id = $1`, [runId]);
    await deleteAgent(owner, ws, agent.id);
    expect(
      await queryOne(`SELECT id FROM agent WHERE id = $1`, [agent.id])
    ).toBeUndefined();
  });

  it("sets, reads, and clears the budget cap, admin-only", async () => {
    expect((await getBudget(ws)).capMicros).toBeNull();

    await setBudget(owner, ws, 5_000_000);
    const seen = await getBudgetFor(admin, ws);
    expect(seen.capMicros).toBe(5_000_000);

    await setBudget(owner, ws, null);
    expect((await getBudget(ws)).capMicros).toBeNull();

    await expect(setBudget(viewer, ws, 1_000_000)).rejects.toThrow();
    await expect(getBudgetFor(viewer, ws)).rejects.toThrow();
  });
});
