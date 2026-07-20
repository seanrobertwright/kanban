import { randomUUID } from "node:crypto";

import Anthropic from "@anthropic-ai/sdk";
import type { PoolClient } from "pg";

import { query, queryOne, withTransaction } from "@/shared/db/client";
import type { Principal } from "@/features/auth/server/principal";
import { getTask } from "@/features/tasks/server/repository";
import { getBoard } from "@/features/board/server/repository";
import { AuthzError, requireTaskRole } from "@/features/workspaces/server/authz";
import { buildTools } from "./tools";
import type { RunContext, Tier } from "./gate";
import { costMicros } from "./cost";
import { assertUnderBudget, isOverBudget } from "./budget";

/**
 * Door 1's runtime — the Tool Runner loop that turns an assignment into work on
 * the board (PRD §7.1, §9's "board-native agent").
 *
 * A run is a first-class record (013), not a request: the assignment enqueues it
 * ('queued'), and this drains it. That keeps a tens-of-seconds, many-round-trip
 * loop off the request path, and makes the run recoverable — a 'queued' row a
 * crash left behind is the endpoint's or a future worker's to pick up, not a lost
 * side effect of one request.
 *
 * The model, thinking, and effort are §7.3's: claude-opus-4-8 (a native agent
 * carries its own model, 012, so this is a fallback), adaptive thinking at high
 * effort. Prompt caching is "load-bearing" there — the board snapshot is a large,
 * stable prefix reused every turn — so it rides a cache_control breakpoint below.
 */

const DEFAULT_MODEL = "claude-opus-4-8";

// The loop's hard iteration ceiling — a backstop beneath the budget cap. The cap
// is the financial guardrail (§7.3); this stops a loop that is cheap-per-turn but
// unproductive from turning forever within budget.
const MAX_ITERATIONS = 40;

const DEFAULT_SYSTEM = `You are a board-native agent working a kanban board through a fixed set of tools.

You act under a human's authority and an approval policy:
- Some actions (commenting, claiming, setting priority/labels/due dates, renaming) take effect immediately.
- Consequential actions (moving a task between columns, assigning it, creating tasks or subtasks) are NOT applied immediately. When you call one, it is proposed and held in this run's changeset for a human to accept or reject after you finish. The tool tells you it was proposed — do not repeat it, and continue with the rest of the task.

Work the task you are given: read it and the board for context, claim it, take the actions it calls for, and comment your reasoning as you go so a human can follow what you did and why. When the task is done, post one short summary comment and stop. Do not ask for permission you do not need, and do not narrate routine steps.`;

interface RunRow {
  agentId: string;
  taskId: number | null;
  workspaceId: string;
  status: string;
}

interface AgentRow {
  model: string | null;
  systemPrompt: string | null;
  approvalPolicy: Partial<Record<string, Tier>>;
  toolAllowlist: string[] | null;
  kind: string;
}

/** The board a task sits on — the run's default board for the read tools. */
async function boardIdForTask(taskId: number): Promise<number | undefined> {
  const row = await queryOne<{ boardId: number }>(
    `SELECT bc.board_id AS "boardId"
       FROM task t JOIN board_column bc ON bc.id = t.column_id
      WHERE t.id = $1`,
    [taskId]
  );
  return row?.boardId;
}

async function finish(runId: string, status: string, error?: string): Promise<void> {
  await query(
    `UPDATE agent_run SET status = $2, error = $3, finished_at = now() WHERE id = $1`,
    [runId, status, error ?? null]
  );
}

/**
 * Drive one run to completion. Safe to call from more than one dispatcher (the
 * after() kick and the durable drainer): the run is claimed atomically below
 * (queued → running only if still queued), so a double-dispatch runs the loop
 * exactly once — the loser of the claim reads zero rows and returns.
 */
export async function executeRun(runId: string): Promise<void> {
  const run = await queryOne<RunRow>(
    `SELECT agent_id AS "agentId", task_id AS "taskId",
            workspace_id AS "workspaceId", status
       FROM agent_run WHERE id = $1`,
    [runId]
  );
  if (!run) return; // deleted out from under us — nothing to do.
  if (run.status !== "queued") return; // already running / finished.
  if (run.taskId === null) {
    await finish(runId, "failed", "Run has no task to work.");
    return;
  }

  const agent = await queryOne<AgentRow>(
    `SELECT model, system_prompt AS "systemPrompt",
            approval_policy AS "approvalPolicy",
            tool_allowlist AS "toolAllowlist", kind
       FROM agent WHERE id = $1`,
    [run.agentId]
  );
  if (!agent || agent.kind !== "native") {
    await finish(runId, "failed", "Run's agent is not a native agent.");
    return;
  }

  const taskId = run.taskId;
  const workspaceId = run.workspaceId;
  const principal = {
    kind: "agent" as const,
    agentId: run.agentId,
    workspaceId,
  };

  // Never spend a cent past a blown cap — the run-start gate, before any model
  // call (§7.3, acceptance #5). isOverBudget on an uncapped workspace is false.
  if (await isOverBudget(workspaceId)) {
    await finish(runId, "halted", "Workspace agent budget cap reached.");
    return;
  }

  const boardId = await boardIdForTask(taskId);
  if (boardId === undefined) {
    await finish(runId, "failed", "Task's board could not be resolved.");
    return;
  }

  let client: Anthropic;
  try {
    // Reads ANTHROPIC_API_KEY (or an `ant auth login` profile) from the env the
    // server was started with. Constructed here, not at module load, so importing
    // this file (for the assignment trigger) never needs a key.
    client = new Anthropic();
  } catch (error) {
    await finish(
      runId,
      "failed",
      error instanceof Error ? error.message : "Anthropic client init failed."
    );
    return;
  }

  // Claim the run atomically: flip queued → running only if it is STILL queued,
  // and take it only if this worker won that flip. This is the concurrency fence
  // that makes the run safe to dispatch from more than one place — the after()
  // kick (dispatchRun) and the durable drainer (drainer.ts) can both call
  // executeRun for the same row; exactly one claims it, the other reads zero rows
  // and returns. started_at and the first heartbeat are stamped here (030).
  const claimed = await query(
    `UPDATE agent_run
        SET status = 'running', started_at = now(), last_heartbeat_at = now()
      WHERE id = $1 AND status = 'queued'
      RETURNING id`,
    [runId]
  );
  if (claimed.length === 0) return; // another worker claimed it first.

  const ctx: RunContext = {
    runId,
    principal,
    policy: agent.approvalPolicy ?? {},
    changesetId: null,
  };

  const model = agent.model ?? DEFAULT_MODEL;
  const tools = buildTools(ctx, boardId, agent.toolAllowlist);

  // The board-context prefix §7.3 caches: the assigned task and the whole board
  // snapshot, stable for the run's life, reused every turn. The cache_control
  // breakpoint sits on the last stable block so system + tools + this whole
  // context are read from cache after the first turn — cutting repeat-turn input
  // cost to ~10%, which is why cache tokens are metered separately (013).
  const task = await getTask(principal, taskId);
  const board = await getBoard(principal, boardId);
  const boardContext =
    `Assigned task (#${taskId}):\n${JSON.stringify(task, null, 2)}\n\n` +
    `The board it is on:\n${JSON.stringify(board, null, 2)}`;
  const instruction =
    `Work task #${taskId}. Claim it, act on it with your tools, comment your ` +
    `reasoning, and post a brief summary when done.`;

  const totals = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
  };
  let halted = false;

  try {
    const runner = client.beta.messages.toolRunner({
      model,
      max_tokens: 64000,
      thinking: { type: "adaptive" },
      output_config: { effort: "high" },
      system: agent.systemPrompt ?? DEFAULT_SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: boardContext },
            {
              type: "text",
              text: instruction,
              cache_control: { type: "ephemeral" },
            },
          ],
        },
      ],
      tools,
      max_iterations: MAX_ITERATIONS,
      stream: true,
    });

    for await (const stream of runner) {
      const message = await stream.finalMessage();
      const u = message.usage;
      totals.inputTokens += u.input_tokens ?? 0;
      totals.outputTokens += u.output_tokens ?? 0;
      totals.cacheReadTokens += u.cache_read_input_tokens ?? 0;
      totals.cacheCreationTokens += u.cache_creation_input_tokens ?? 0;

      // Persist the running meter BEFORE the budget check, so the check — which
      // sums this workspace's runs, this one included — sees the spend this run
      // has just incurred. The run in progress is the one that might run away.
      await query(
        `UPDATE agent_run
            SET input_tokens = $2, output_tokens = $3,
                cache_read_tokens = $4, cache_creation_tokens = $5,
                cost_micros = $6, last_heartbeat_at = now()
          WHERE id = $1`,
        [
          runId,
          totals.inputTokens,
          totals.outputTokens,
          totals.cacheReadTokens,
          totals.cacheCreationTokens,
          costMicros(model, totals),
        ]
      );

      if (await isOverBudget(workspaceId)) {
        halted = true;
        break; // stop cleanly: no further turn is requested.
      }
    }
  } catch (error) {
    await finish(
      runId,
      "failed",
      error instanceof Error ? error.message : "Agent run failed."
    );
    return;
  }

  if (halted) {
    await finish(runId, "halted", "Workspace agent budget cap reached mid-run.");
    return;
  }
  // A run that proposed anything for review ends 'awaiting_review'; one whose
  // every action was auto-tier (nothing to review) ends 'succeeded'. ctx.changesetId
  // is set iff ensureChangeset ran (gate.ts) — i.e. iff a changeset-tier call was made.
  await finish(runId, ctx.changesetId ? "awaiting_review" : "succeeded");
}

/**
 * Enqueue a run for a native-agent assignment — the durable trigger. Called
 * inside updateTask's transaction (011's "assigning is the event that starts
 * it"), so the queued row commits with the task.assigned it follows. Returns the
 * run id, or null if the assignee is not a native agent (an external agent or a
 * human starts no run). Takes the transaction client so the insert is atomic with
 * the assignment.
 */
export async function enqueueRun(
  client: PoolClient,
  input: { agentId: string; taskId: number; workspaceId: string }
): Promise<string | null> {
  const { rows } = await client.query(
    `SELECT 1 FROM agent WHERE id = $1 AND kind = 'native'`,
    [input.agentId]
  );
  if (rows.length === 0) return null;
  const runId = randomUUID();
  await client.query(
    `INSERT INTO agent_run (id, agent_id, task_id, workspace_id)
     VALUES ($1, $2, $3, $4)`,
    [runId, input.agentId, input.taskId, input.workspaceId]
  );
  return runId;
}

/**
 * Kick a queued run's execution off the request path via Next's after(), so the
 * assignment PATCH returns immediately while the loop runs on the persistent Node
 * server. Best-effort: outside a request scope (a test, the isolated agent-run
 * script) after() throws, and the run simply stays 'queued' — and if the process
 * dies before the callback fires, likewise. Either way the durable drainer
 * (drainer.ts) re-dispatches it, which is the point of making a run a record, not
 * a request. The dynamic import keeps next/server out of the module graph until a
 * dispatch actually happens.
 */
export function dispatchRun(runId: string): void {
  void (async () => {
    try {
      const { after } = await import("next/server");
      after(() => executeRun(runId));
    } catch {
      // No request scope — leave it queued. A caller that wants a synchronous
      // run (a test) calls executeRun directly instead.
    }
  })();
}

/**
 * Start a run on demand for a task already assigned to a native agent — the
 * endpoint behind POST /api/agents/runs, and the re-run path when a human wants
 * to point the agent at the task again without touching its assignment.
 *
 * The caller (a human) must be a member of the task's workspace — triggering an
 * agent to act is a write. The task must actually be held by a native agent;
 * otherwise there is no agent to run, which is a 'conflict' (a state, not a
 * permission the caller lacks). The budget is checked before a cent is spent.
 */
export async function startRunForTask(
  principal: string | Principal,
  taskId: number
): Promise<string> {
  const { workspaceId } = await requireTaskRole(principal, taskId, "member");

  const row = await queryOne<{ agentId: string | null }>(
    `SELECT agent_id AS "agentId" FROM task WHERE id = $1`,
    [taskId]
  );
  if (!row?.agentId) {
    throw new AuthzError("conflict", "This task is not assigned to an agent");
  }
  const native = await queryOne<{ one: number }>(
    `SELECT 1 AS one FROM agent WHERE id = $1 AND kind = 'native'`,
    [row.agentId]
  );
  if (!native) {
    throw new AuthzError(
      "conflict",
      "This task is assigned to an external agent, which runs itself over MCP"
    );
  }

  await assertUnderBudget(workspaceId);

  const runId = await withTransaction((client) =>
    enqueueRun(client, { agentId: row.agentId!, taskId, workspaceId })
  );
  if (!runId) {
    throw new AuthzError("conflict", "This task is not assigned to a native agent");
  }
  dispatchRun(runId);
  return runId;
}
