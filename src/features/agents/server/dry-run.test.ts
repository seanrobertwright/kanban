import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * A human principal needs a better-auth session, which a unit test has no way to
 * mint. The header below stands in for the cookie: the seam is the same function
 * the real resolution runs through, so what is being tested is still
 * "getPrincipalFromRequest said human" — only the way it got there is faked.
 */
vi.mock("@/features/auth/server/session", async (importOriginal) => {
  const original = await importOriginal<
    typeof import("@/features/auth/server/session")
  >();
  return {
    ...original,
    getSessionFromRequest: async (request: Request) => {
      const user = request.headers.get("x-test-user");
      return user ? { user: { id: user } } : null;
    },
  };
});

import { createAgent } from "@/features/agents/server/admin";
import { getBoard } from "@/features/board/server/repository";
import {
  ensurePersonalWorkspace,
  getDefaultBoard,
} from "@/features/workspaces/server/repository";
import {
  handleBulkTasks,
  handleClaimTask,
  handleCreateTask,
  handleUpdateTask,
} from "@/features/tasks/server/handlers";
import { createTask, getTask } from "@/features/tasks/server/repository";
import { pool, query } from "@/shared/db/client";
import { withDryRun } from "@/shared/db/with-dry-run";
import { withIdempotency, IDEMPOTENCY_HEADER } from "@/shared/db/idempotency";

/**
 * Dry run (§4.4 item 9), against the real database, through the real handlers.
 *
 * Real-DB for the reason the idempotency suite is: the claim being made is about
 * rows — that none appeared. A stubbed store would assert the branch structure
 * and prove nothing about the property the feature is named for, so the
 * load-bearing assertion in nearly every case below is a count or a re-read of
 * state that must not have moved. Two invisible tables are counted alongside the
 * board's: `agent_run` and `agent_action`, because a dry run that quietly minted
 * a proposal would leave the board untouched and a human's review queue full.
 */

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

interface DryRunBody {
  dryRun: boolean;
  actions: {
    tool: string;
    tier: string;
    outcome: string;
    taskId: number | null;
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
    changed: string[];
    unprojected: string[];
  }[];
}

describe("dry run", () => {
  let alice: string;
  let token: string;
  let botId: string;
  let columnId: number;
  let otherColumnId: number;
  let taskId: number;

  const headers = (dry: string | null, extra: Record<string, string> = {}) => ({
    "content-type": "application/json",
    "x-agent-key": token,
    ...(dry === null ? {} : { "dry-run": dry }),
    ...extra,
  });

  /** The wiring exactly as each route file does it. */
  const sendPatch = (id: number, body: unknown, dry: string | null = "true") => {
    const request = new Request(`http://test/api/tasks/${id}`, {
      method: "PATCH",
      headers: headers(dry),
      body: JSON.stringify(body),
    });
    return withDryRun(request, () => handleUpdateTask(request, id));
  };

  const sendCreate = (
    body: unknown,
    dry: string | null = "true",
    extra: Record<string, string> = {}
  ) => {
    const request = new Request("http://test/api/tasks", {
      method: "POST",
      headers: headers(dry, extra),
      body: JSON.stringify(body),
    });
    return withDryRun(request, () =>
      withIdempotency(request, () => handleCreateTask(request))
    );
  };

  const countTitled = async (title: string) =>
    Number(
      (
        await query<{ n: string }>(
          `SELECT count(*) AS n FROM task WHERE title = $1`,
          [title]
        )
      )[0].n
    );

  const agentRows = async () =>
    Number(
      (
        await query<{ n: string }>(
          `SELECT (SELECT count(*) FROM agent_run WHERE agent_id = $1)
                + (SELECT count(*) FROM agent_action a
                     JOIN agent_run r ON r.id = a.run_id WHERE r.agent_id = $1) AS n`,
          [botId]
        )
      )[0].n
    );

  const setPolicy = (policy: Record<string, string>) =>
    query(`UPDATE agent SET approval_policy = $2::jsonb WHERE id = $1`, [
      botId,
      JSON.stringify(policy),
    ]);

  beforeAll(async () => {
    alice = await createUser("dryrun-alice");
    const ws = await ensurePersonalWorkspace(alice, "DryRunAlice");
    const boardId = (await getDefaultBoard(alice))!.id;
    const board = (await getBoard(alice, boardId))!;
    columnId = board.columns[0].id;
    otherColumnId = board.columns[1].id;

    const bot = await createAgent(alice, ws.id, {
      name: "Dry Run Bot",
      role: "member",
      kind: "external",
    });
    token = bot.token!;
    botId = bot.agent.id;

    taskId = (
      await createTask(alice, { columnId, title: "Subject", priority: "low" })
    ).id;
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

  it("reports an auto-tier field edit as would_apply, and edits nothing", async () => {
    const before = await getTask(alice, taskId);
    const response = await sendPatch(taskId, { priority: "urgent" });
    const body = (await response.json()) as DryRunBody;

    expect(response.status).toBe(200);
    expect(response.headers.get("dry-run")).toBe("true");
    expect(body.dryRun).toBe(true);
    expect(body.actions).toHaveLength(1);
    expect(body.actions[0]).toMatchObject({
      tool: "update_task",
      tier: "auto",
      outcome: "would_apply",
      taskId,
      changed: ["priority"],
    });
    expect(body.actions[0].before).toMatchObject({ priority: "low" });
    expect(body.actions[0].after).toMatchObject({ priority: "urgent" });

    // The point of the whole feature, asserted on the row rather than the body.
    expect((await getTask(alice, taskId))!.priority).toBe(before!.priority);
  });

  it("reports a changeset-tier create as would_hold, and creates no task", async () => {
    const response = await sendCreate({ columnId, title: "Planned only" });
    const body = (await response.json()) as DryRunBody;

    expect(body.actions[0]).toMatchObject({
      tool: "create_task",
      tier: "changeset",
      outcome: "would_hold",
      taskId: null,
    });
    // A create projects onto nothing, so the request itself is the after.
    expect(body.actions[0].before).toBeNull();
    expect(body.actions[0].after).toMatchObject({ columnId, title: "Planned only" });
    expect(await countTitled("Planned only")).toBe(0);
  });

  it("answers for a blocked tool instead of refusing it", async () => {
    await setPolicy({ move_task: "block" });
    const response = await sendPatch(taskId, { columnId: otherColumnId, position: 0 });
    const body = (await response.json()) as DryRunBody;

    expect(response.status).toBe(200);
    expect(body.actions[0]).toMatchObject({
      tool: "move_task",
      tier: "block",
      outcome: "would_block",
      changed: ["columnId"],
    });
    // The real call, by contrast, is a 403 the agent learns nothing from.
    const real = await sendPatch(taskId, { columnId: otherColumnId, position: 0 }, null);
    expect(real.status).toBe(403);
    await setPolicy({});
  });

  it("reports every action one request would take, in the order it would take them", async () => {
    const response = await sendPatch(taskId, {
      columnId: otherColumnId,
      position: 0,
      title: "Renamed",
      assignee: null,
    });
    const body = (await response.json()) as DryRunBody;

    expect(body.actions.map((a) => a.tool)).toEqual([
      "move_task",
      "update_task",
      "assign_task",
    ]);
    // The assignment is its own action, exactly as the held path splits it, so
    // it must not also appear inside the update's diff.
    expect(body.actions[1].changed).toEqual(["title"]);
    expect(body.actions[2].tool).toBe("assign_task");
    expect((await getTask(alice, taskId))!.title).toBe("Subject");
  });

  it("writes no run and no proposal — a plan is not a held changeset", async () => {
    const before = await agentRows();
    await sendPatch(taskId, { priority: "high" });
    await sendCreate({ columnId, title: "Also planned only" });
    expect(await agentRows()).toBe(before);
  });

  it("lets a refusal outrank a plan", async () => {
    // The move is legal and plans; the title is not and rejects. Answering with
    // the plan would describe a request that would never have run.
    const response = await sendPatch(taskId, {
      columnId: otherColumnId,
      position: 0,
      title: "   ",
    });
    expect(response.status).toBe(400);
  });

  it("refuses a create the agent could not have made", async () => {
    const bob = await createUser("dryrun-bob");
    await ensurePersonalWorkspace(bob, "DryRunBob");
    const foreign = (await getBoard(bob, (await getDefaultBoard(bob))!.id))!
      .columns[0].id;

    const response = await sendCreate({ columnId: foreign, title: "Not mine" });
    // The same answer the real call gives, from the same check — not a confident
    // "would_apply" for a column this agent cannot write to.
    expect([403, 404]).toContain(response.status);
  });

  it("spends no idempotency key, so the real create still creates", async () => {
    const key = randomUUID();
    const planned = await sendCreate(
      { columnId, title: "Keyed after planning" },
      "true",
      { [IDEMPOTENCY_HEADER]: key }
    );
    expect(planned.status).toBe(200);
    expect(await countTitled("Keyed after planning")).toBe(0);

    await setPolicy({ create_task: "auto" });
    const real = await sendCreate({ columnId, title: "Keyed after planning" }, null, {
      [IDEMPOTENCY_HEADER]: key,
    });
    expect(real.status).toBe(201);
    expect(await countTitled("Keyed after planning")).toBe(1);
    await setPolicy({});
  });

  it("says so plainly for a mutation it will not simulate", async () => {
    const request = new Request(`http://test/api/tasks/${taskId}/claim`, {
      method: "POST",
      headers: headers("true"),
    });
    const response = await withDryRun(request, () =>
      handleClaimTask(request, taskId)
    );
    expect(response.status).toBe(501);
    expect((await response.json()).code).toBe("DRY_RUN_UNSUPPORTED");
    // And it took no claim on the way to saying so.
    expect((await getTask(alice, taskId))!.claimedBy).toBeNull();

    const bulk = new Request("http://test/api/tasks/bulk", {
      method: "POST",
      headers: headers("true"),
      body: JSON.stringify({ ids: [taskId], priority: "urgent" }),
    });
    const bulkResponse = await withDryRun(bulk, () => handleBulkTasks(bulk));
    expect(bulkResponse.status).toBe(501);
    expect((await getTask(alice, taskId))!.priority).not.toBe("urgent");
  });

  it("applies for real when the header says false, and refuses a header that says neither", async () => {
    await setPolicy({ create_task: "auto" });
    const real = await sendCreate({ columnId, title: "Explicitly real" }, "false");
    expect(real.status).toBe(201);
    expect(await countTitled("Explicitly real")).toBe(1);
    await setPolicy({});

    const nonsense = await sendCreate({ columnId, title: "Never" }, "maybe");
    expect(nonsense.status).toBe(400);
    expect((await nonsense.json()).code).toBe("INVALID_DRY_RUN");
    expect(await countTitled("Never")).toBe(0);
  });

  it("is an agent affordance: a human asking for one is refused, not half-served", async () => {
    const request = new Request("http://test/api/tasks", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "dry-run": "true",
        "x-test-user": alice,
      },
      body: JSON.stringify({ columnId, title: "Human dry run" }),
    });
    const response = await withDryRun(request, () => handleCreateTask(request));

    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe("DRY_RUN_AGENT_ONLY");
    expect(await countTitled("Human dry run")).toBe(0);
  });
});
