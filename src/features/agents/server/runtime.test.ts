import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { getBoard } from "@/features/board/server/repository";
import { listRawActivityForTask } from "@/features/activity/server/repository";
import {
  ensurePersonalWorkspace,
  getDefaultBoard,
} from "@/features/workspaces/server/repository";
import { createTask, getTask } from "@/features/tasks/server/repository";
import { pool, query, queryOne } from "@/shared/db/client";

/**
 * Against a real Postgres, and with the Anthropic client stubbed — the one seam
 * that reaches the network. What is under test is everything BELOW the model:
 * the §7.4 gate applying auto vs changeset, the mutations landing (or not) on the
 * real board through the real repository, the audit trail, and the budget halt.
 * The "model" is scripted: h.script stands in for the turns' worth of tool calls
 * a real run would make, so the tiers and the loop are exercised deterministically.
 */

const h = vi.hoisted(() => ({
  script: null as null | ((tools: { name: string; run: (a: unknown) => unknown }[]) => Promise<void>),
  turns: 1,
  runs: 0,
  usage: {
    input_tokens: 1000,
    output_tokens: 200,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  },
}));

vi.mock("@anthropic-ai/sdk", () => {
  class FakeAnthropic {
    beta = {
      messages: {
        toolRunner: (params: { tools: { name: string; run: (a: unknown) => unknown }[] }) =>
          (async function* () {
            for (let i = 0; i < h.turns; i++) {
              h.runs += 1;
              if (h.script) await h.script(params.tools);
              yield { finalMessage: async () => ({ usage: h.usage }) };
            }
          })(),
      },
    };
  }
  return { default: FakeAnthropic };
});

// Imported AFTER the mock is registered (vi.mock is hoisted above it anyway).
const { executeRun, enqueueRun, startRunForTask } = await import("./runtime");
const { getRunDetail, reviewChangeset, revertAction } = await import("./review");
const { drainOnce } = await import("./drainer");

async function createUser(label: string): Promise<string> {
  const id = `test-${label}-${randomUUID()}`;
  await query(
    `INSERT INTO "user" (id, name, email, "emailVerified")
     VALUES ($1, $2, $3, true)`,
    [id, `Test ${label}`, `${id}@example.test`]
  );
  return id;
}

const run = (tools: { name: string; run: (a: unknown) => unknown }[], name: string) =>
  tools.find((t) => t.name === name)!;

describe("Door 1 runtime", () => {
  let owner: string;
  let workspaceId: string;
  let todo: number;
  let done: number;
  let agentId: string;

  beforeAll(async () => {
    owner = await createUser("d1-owner");
    await ensurePersonalWorkspace(owner, "D1");
    const boardId = (await getDefaultBoard(owner))!.id;
    const board = (await getBoard(owner, boardId))!;
    todo = board.columns[0].id;
    done = board.columns[board.columns.length - 1].id;
    workspaceId = (await queryOne<{ w: string }>(
      `SELECT workspace_id AS w FROM board WHERE id = $1`,
      [boardId]
    ))!.w;

    agentId = randomUUID();
    await query(
      `INSERT INTO agent (id, workspace_id, name, role, kind, model, system_prompt)
       VALUES ($1, $2, 'Triage Bot', 'member', 'native', 'claude-opus-4-8', 'be helpful')`,
      [agentId, workspaceId]
    );
  });

  afterAll(async () => {
    await query(`DELETE FROM workspace WHERE id = $1`, [workspaceId]);
    await query(`DELETE FROM "user" WHERE id = $1`, [owner]);
    await pool.end();
  });

  const seedTask = async () =>
    (await createTask(owner, { columnId: todo, title: "Inbound bug" })).id;

  const enqueue = (taskId: number) =>
    pool.connect().then(async (c) => {
      try {
        return await enqueueRun(c, { agentId, taskId, workspaceId });
      } finally {
        c.release();
      }
    });

  it("applies auto-tier actions immediately and holds changeset-tier for review", async () => {
    h.turns = 1;
    h.runs = 0;
    const taskId = await seedTask();

    h.script = async (tools) => {
      await run(tools, "claim_task").run({ id: taskId });
      await run(tools, "set_priority").run({ id: taskId, priority: "high" });
      await run(tools, "comment_on_task").run({ id: taskId, body: "Looks urgent." });
      // changeset tier — proposed, must NOT apply now.
      await run(tools, "move_task").run({ id: taskId, columnId: done, position: 0 });
    };

    const runId = (await enqueue(taskId))!;
    await executeRun(runId);

    // The run ends awaiting review, because move_task was proposed.
    const runRow = await queryOne<{ status: string; cost: string }>(
      `SELECT status, cost_micros AS cost FROM agent_run WHERE id = $1`,
      [runId]
    );
    expect(runRow!.status).toBe("awaiting_review");
    expect(Number(runRow!.cost)).toBeGreaterThan(0);

    // Auto tier landed on the real board: priority set, claimed by the agent.
    const task = (await getTask(owner, taskId))!;
    expect(task.priority).toBe("high");
    expect(task.claimedBy).toEqual({ type: "agent", id: agentId });
    expect(task.columnId).toBe(todo); // move was NOT applied.

    // The audit trail shows the auto actions (agent actor), and no move.
    const actions = (await listRawActivityForTask(taskId)).map((a) => a.action);
    expect(actions).toContain("task.claimed");
    expect(actions).toContain("task.prioritized");
    expect(actions).toContain("comment.created");
    expect(actions).not.toContain("task.moved");

    // agent_action recorded every call with its tier; the move is proposed into
    // a pending changeset.
    const acts = await query<{ tool: string; tier: string }>(
      `SELECT tool, tier FROM agent_action WHERE run_id = $1 ORDER BY created_at`,
      [runId]
    );
    expect(acts.map((a) => a.tool)).toEqual([
      "claim_task",
      "set_priority",
      "comment_on_task",
      "move_task",
    ]);
    expect(acts.find((a) => a.tool === "move_task")!.tier).toBe("changeset");
    const cs = await queryOne<{ status: string }>(
      `SELECT status FROM changeset WHERE run_id = $1`,
      [runId]
    );
    expect(cs!.status).toBe("pending");

    // An auto-tier action links to the activity_log row it produced (013): the
    // set_priority action's activity_id resolves to the task.prioritized entry.
    const prioritized = await queryOne<{ activityId: string; action: string }>(
      `SELECT aa.activity_id AS "activityId", al.action
         FROM agent_action aa JOIN activity_log al ON al.id = aa.activity_id
        WHERE aa.run_id = $1 AND aa.tool = 'set_priority'`,
      [runId]
    );
    expect(prioritized!.activityId).not.toBeNull();
    expect(prioritized!.action).toBe("task.prioritized");
    // The held changeset action has produced nothing yet, so it links to nothing.
    const heldMove = await queryOne<{ activityId: string | null }>(
      `SELECT activity_id AS "activityId" FROM agent_action
        WHERE run_id = $1 AND tool = 'move_task'`,
      [runId]
    );
    expect(heldMove!.activityId).toBeNull();
  });

  it("a run with only auto-tier actions succeeds outright", async () => {
    h.turns = 1;
    const taskId = await seedTask();
    h.script = async (tools) => {
      await run(tools, "set_priority").run({ id: taskId, priority: "low" });
    };
    const runId = (await enqueue(taskId))!;
    await executeRun(runId);
    const status = (await queryOne<{ s: string }>(
      `SELECT status AS s FROM agent_run WHERE id = $1`,
      [runId]
    ))!.s;
    expect(status).toBe("succeeded");
  });

  it("flags a blocked-by edge immediately (auto tier) and records the action", async () => {
    h.turns = 1;
    const taskId = await seedTask();
    const blockerId = await seedTask();
    h.script = async (tools) => {
      await run(tools, "flag_blocker").run({ id: taskId, dependsOnId: blockerId });
    };
    const runId = (await enqueue(taskId))!;
    await executeRun(runId);

    // Auto tier: the run has nothing to review, so it succeeds outright.
    const status = (await queryOne<{ s: string }>(
      `SELECT status AS s FROM agent_run WHERE id = $1`,
      [runId]
    ))!.s;
    expect(status).toBe("succeeded");

    // The edge landed on the real board, agent-authored.
    const edge = await queryOne<{ n: string }>(
      `SELECT count(*) AS n FROM task_dependency
        WHERE task_id = $1 AND depends_on_task_id = $2`,
      [taskId, blockerId]
    );
    expect(Number(edge!.n)).toBe(1);

    // Recorded in the agent-action trail at the auto tier. activity_id stays null:
    // a dependency edge is not written to activity_log (018), so there is no row
    // to link — the honest value for a silent mutation.
    const act = await queryOne<{ tier: string; activityId: string | null }>(
      `SELECT tier, activity_id AS "activityId"
         FROM agent_action WHERE run_id = $1 AND tool = 'flag_blocker'`,
      [runId]
    );
    expect(act!.tier).toBe("auto");
    expect(act!.activityId).toBeNull();
  });

  it("halts cleanly when the workspace budget cap is exceeded", async () => {
    // Set the cap just above what this workspace has already spent, so the
    // pre-loop check passes and the FIRST turn's usage is what pushes it over —
    // exercising the mid-loop halt rather than the start-of-run refusal.
    const spent = Number(
      (await queryOne<{ s: string }>(
        `SELECT COALESCE(SUM(cost_micros), 0) AS s FROM agent_run
          WHERE workspace_id = $1 AND created_at >= date_trunc('month', now())`,
        [workspaceId]
      ))!.s
    );
    await query(`UPDATE workspace SET agent_budget_micros = $2 WHERE id = $1`, [
      workspaceId,
      spent + 1,
    ]);
    h.turns = 3; // would run three turns if not halted
    h.runs = 0;
    const taskId = await seedTask();
    h.script = async (tools) => {
      await run(tools, "set_priority").run({ id: taskId, priority: "medium" });
    };
    const runId = (await enqueue(taskId))!;
    await executeRun(runId);

    const status = (await queryOne<{ s: string }>(
      `SELECT status AS s FROM agent_run WHERE id = $1`,
      [runId]
    ))!.s;
    expect(status).toBe("halted");
    // Stopped after the first turn — the budget check breaks the loop before the
    // second model call, so the scripted turns did not all run.
    expect(h.runs).toBe(1);

    await query(`UPDATE workspace SET agent_budget_micros = NULL WHERE id = $1`, [
      workspaceId,
    ]);
  });

  it("refuses to start a run for a task with no native agent", async () => {
    const taskId = await seedTask(); // unassigned
    await expect(startRunForTask(owner, taskId)).rejects.toThrow(
      /not assigned to an agent/i
    );
  });

  it("applies a changeset action only when a human accepts it", async () => {
    await query(`UPDATE workspace SET agent_budget_micros = NULL WHERE id = $1`, [
      workspaceId,
    ]);
    h.turns = 1;
    const taskId = await seedTask();
    h.script = async (tools) => {
      await run(tools, "move_task").run({ id: taskId, columnId: done, position: 0 });
    };
    const runId = (await enqueue(taskId))!;
    await executeRun(runId);

    // Proposed, not applied.
    expect((await getTask(owner, taskId))!.columnId).toBe(todo);

    const detail = (await getRunDetail(owner, runId))!;
    expect(detail.status).toBe("awaiting_review");
    const moveAction = detail.actions.find((a) => a.tool === "move_task")!;
    const changesetId = detail.changeset!.id;

    // Accept it → the move runs for real, as the agent.
    const after = await reviewChangeset(owner, changesetId, [moveAction.id]);
    expect(after.changeset!.status).toBe("accepted");
    expect(after.status).toBe("succeeded");
    expect((await getTask(owner, taskId))!.columnId).toBe(done);
    const actions = (await listRawActivityForTask(taskId)).map((a) => a.action);
    expect(actions).toContain("task.moved");

    // Accepting the proposal is where the move first mutates, so this is where its
    // activity_id is stamped (013): the accepted action now links to task.moved.
    const applied = await queryOne<{ activityId: string; action: string }>(
      `SELECT aa.activity_id AS "activityId", al.action
         FROM agent_action aa JOIN activity_log al ON al.id = aa.activity_id
        WHERE aa.id = $1`,
      [moveAction.id]
    );
    expect(applied!.activityId).not.toBeNull();
    expect(applied!.action).toBe("task.moved");

    // A second review is refused.
    await expect(reviewChangeset(owner, changesetId, [])).rejects.toThrow(
      /already been reviewed/i
    );
  });

  it("undoes an auto-tier field edit by restoring the before snapshot", async () => {
    h.turns = 1;
    const taskId = await seedTask(); // priority 'none'
    h.script = async (tools) => {
      await run(tools, "set_priority").run({ id: taskId, priority: "urgent" });
    };
    const runId = (await enqueue(taskId))!;
    await executeRun(runId);
    expect((await getTask(owner, taskId))!.priority).toBe("urgent");

    const detail = (await getRunDetail(owner, runId))!;
    const action = detail.actions.find((a) => a.tool === "set_priority")!;

    await revertAction(owner, action.id);
    expect((await getTask(owner, taskId))!.priority).toBe("none");

    // Undoing twice is refused.
    await expect(revertAction(owner, action.id)).rejects.toThrow(
      /already undone/i
    );
  });

  it("drainer re-dispatches a stale queued run that after() never kicked", async () => {
    h.turns = 1;
    const taskId = await seedTask();
    h.script = async (tools) => {
      await run(tools, "set_priority").run({ id: taskId, priority: "low" });
    };
    // Enqueued but never dispatched (enqueue does not call dispatchRun). Backdate
    // it past the grace window so the drainer treats it as an orphan.
    const runId = (await enqueue(taskId))!;
    await query(
      `UPDATE agent_run SET created_at = now() - interval '5 minutes' WHERE id = $1`,
      [runId]
    );

    const swept = await drainOnce();
    expect(swept).toBeGreaterThanOrEqual(1);

    const status = (await queryOne<{ s: string }>(
      `SELECT status AS s FROM agent_run WHERE id = $1`,
      [runId]
    ))!.s;
    expect(status).toBe("succeeded");
  });

  it("drainer leaves a fresh queued run inside the grace window alone", async () => {
    const taskId = await seedTask();
    // created_at defaults to now(): still within grace, so its own after() kick
    // owns it and the drainer must not double-run it.
    const runId = (await enqueue(taskId))!;

    await drainOnce();

    const status = (await queryOne<{ s: string }>(
      `SELECT status AS s FROM agent_run WHERE id = $1`,
      [runId]
    ))!.s;
    expect(status).toBe("queued");
  });

  it("drainer requeues and re-runs a run whose heartbeat went stale (crash)", async () => {
    h.turns = 1;
    const taskId = await seedTask();
    h.script = async (tools) => {
      await run(tools, "set_priority").run({ id: taskId, priority: "high" });
    };
    const runId = (await enqueue(taskId))!;
    // Simulate a crash mid-flight: 'running', but the heartbeat stopped long ago.
    // created_at stays recent — the crash path must dispatch it regardless of the
    // orphan grace window, which this asserts by leaving created_at fresh.
    await query(
      `UPDATE agent_run
          SET status = 'running',
              started_at = now() - interval '1 hour',
              last_heartbeat_at = now() - interval '1 hour'
        WHERE id = $1`,
      [runId]
    );

    const swept = await drainOnce();
    expect(swept).toBeGreaterThanOrEqual(1);

    const status = (await queryOne<{ s: string }>(
      `SELECT status AS s FROM agent_run WHERE id = $1`,
      [runId]
    ))!.s;
    expect(status).toBe("succeeded");
  });

  it("drainer leaves a healthy running run (fresh heartbeat) untouched", async () => {
    const taskId = await seedTask();
    const runId = (await enqueue(taskId))!;
    // Running with a heartbeat as of now — a live loop, not a crash.
    await query(
      `UPDATE agent_run
          SET status = 'running', started_at = now(), last_heartbeat_at = now()
        WHERE id = $1`,
      [runId]
    );

    await drainOnce();

    const status = (await queryOne<{ s: string }>(
      `SELECT status AS s FROM agent_run WHERE id = $1`,
      [runId]
    ))!.s;
    expect(status).toBe("running");
  });
});
