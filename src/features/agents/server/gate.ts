import { randomUUID } from "node:crypto";

import { query, queryOne } from "@/shared/db/client";
import type { Principal } from "@/features/auth/server/principal";
import { getTask } from "@/features/tasks/server/repository";
import { captureActivity } from "@/features/activity/server/activity-capture";

/**
 * §7.4's approval model, as the seam every mutating tool passes through. Three
 * tiers, gated per tool by blast radius:
 *
 *   auto+undo — cheap, internally reversible, externally silent (label,
 *     prioritize, comment, claim). Executes now; reversible for a window.
 *   changeset — the default for consequential work (status moves, reassignment,
 *     decomposition). The agent proposes; a human reviews the whole run as one
 *     diff and accepts all / some / none. "A pull request for the board."
 *   block — destructive or irreversible. Never autonomous.
 *
 * This is where §7.2's mechanism lands: "the Tool Runner yields the assistant
 * message before tools execute, so a pending call can be held." A changeset- or
 * block-tier call is held — it never reaches the repository — so the audit log
 * never records a mutation that did not happen. Only auto-tier calls mutate now.
 */
export type Tier = "auto" | "changeset" | "block";

/**
 * The default tier for each mutating tool, by blast radius — §7.4's "gating is
 * per-tool, defaulted by blast radius". These are the defaults the agent's own
 * approval_policy (012) overlays; an agent with an empty policy is gated exactly
 * this way. The mapping is §7.4's own examples made concrete:
 *
 *   auto      — comment, claim/release, the field edits that are internally
 *               reversible and trigger nothing outside the board (priority,
 *               labels, due date, estimate, type, milestone, rename), and
 *               flagging a blocked-by edge
 *               (018's dependency: silent, idempotent, reversible by removal).
 *   changeset — the consequential moves §7.4 names by name: status (move),
 *               reassignment (assign), decomposition (create task/subtask).
 *
 * Nothing defaults to block here because the destructive tools (delete, archive)
 * are simply not exposed to the agent at all — the same cut Door 2 makes
 * (mcp/README.md). A tool the agent cannot call needs no gate.
 */
export const DEFAULT_TIER: Record<string, Tier> = {
  comment_on_task: "auto",
  claim_task: "auto",
  release_task: "auto",
  set_priority: "auto",
  set_labels: "auto",
  set_due_date: "auto",
  set_estimate: "auto",
  set_type: "auto",
  aim_at_milestone: "auto",
  rename_task: "auto",
  flag_blocker: "auto",
  assign_task: "changeset",
  move_task: "changeset",
  create_task: "changeset",
  create_subtask: "changeset",
};

/**
 * The agent identity and run a tool call executes within. Built once per run
 * (runtime.ts) and threaded into every tool's run function. `changesetId` is
 * mutable because the run's one changeset (013) is created lazily — only when the
 * first changeset-tier call arrives — so a run whose every action is auto-tier
 * never creates one and goes straight to 'succeeded'.
 */
export interface RunContext {
  runId: string;
  principal: Extract<Principal, { kind: "agent" }>;
  /** The agent's per-tool overrides (012); gaps fall through to DEFAULT_TIER. */
  policy: Partial<Record<string, Tier>>;
  changesetId: string | null;
}

/** The tier a tool call runs under: the agent's override, else the blast-radius
 *  default, else 'changeset' — an unknown mutating tool is held, not run. */
export function tierFor(ctx: RunContext, tool: string): Tier {
  return ctx.policy[tool] ?? DEFAULT_TIER[tool] ?? "changeset";
}

/** One run has at most one changeset (013's UNIQUE(run_id)); create it the first
 *  time a changeset-tier call needs somewhere to land, and cache the id. */
async function ensureChangeset(ctx: RunContext): Promise<string> {
  if (ctx.changesetId) return ctx.changesetId;
  const id = randomUUID();
  await query(
    `INSERT INTO changeset (id, run_id) VALUES ($1, $2)
       ON CONFLICT (run_id) DO NOTHING`,
    [id, ctx.runId]
  );
  // ON CONFLICT covers the (impossible in a single-threaded loop, but cheap)
  // case of a re-entry: read back whichever id won.
  const row = await queryOne<{ id: string }>(
    `SELECT id FROM changeset WHERE run_id = $1`,
    [ctx.runId]
  );
  ctx.changesetId = row?.id ?? id;
  return ctx.changesetId;
}

async function recordAction(fields: {
  runId: string;
  changesetId: string | null;
  tool: string;
  tier: Tier;
  input: unknown;
  result: unknown;
  before: unknown;
  after: unknown;
  /** The activity_log row this action produced (013), when it mutated the board
   *  now (auto tier). Null for block/changeset, which log nothing at gate time,
   *  and for auto tools that write no activity_log row (e.g. flag_blocker). */
  activityId?: string | null;
}): Promise<void> {
  await query(
    `INSERT INTO agent_action
       (id, run_id, changeset_id, tool, tier, input, result, before, after, activity_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      randomUUID(),
      fields.runId,
      fields.changesetId,
      fields.tool,
      fields.tier,
      fields.input,
      fields.result ?? null,
      fields.before ?? null,
      fields.after ?? null,
      fields.activityId ?? null,
    ]
  );
}

/**
 * Runs a mutating tool call through the §7.4 gate and returns the string the
 * model reads back. `execute` is the real repository mutation — it is called
 * ONLY on the auto tier. `describe`/`proposal` phrase the outcome for the model.
 *
 * `taskId`, when given, names the task the call targets, so a `before` snapshot
 * can be captured for undo (auto) and for the reviewer's from/to (changeset).
 * Tools that create a task (no prior state) or do not target one pass null.
 */
export async function gate<T>(
  ctx: RunContext,
  spec: {
    tool: string;
    input: unknown;
    taskId: number | null;
    execute: () => Promise<T>;
    describe: (result: T) => string;
    proposal: string;
  }
): Promise<string> {
  const tier = tierFor(ctx, spec.tool);

  // The from-state, read as the agent principal so it is the same RBAC-scoped
  // view the mutation would see. Undefined (task gone / not visible) becomes null.
  const before =
    spec.taskId === null
      ? null
      : (await getTask(ctx.principal, spec.taskId)) ?? null;

  if (tier === "block") {
    await recordAction({
      runId: ctx.runId,
      changesetId: null,
      tool: spec.tool,
      tier,
      input: spec.input,
      result: null,
      before,
      after: null,
    });
    return `Blocked: "${spec.tool}" requires explicit human approval and was not performed.`;
  }

  if (tier === "changeset") {
    const changesetId = await ensureChangeset(ctx);
    await recordAction({
      runId: ctx.runId,
      changesetId,
      tool: spec.tool,
      tier,
      input: spec.input,
      result: null,
      before,
      after: null,
    });
    return (
      `Proposed for review: ${spec.proposal}. ` +
      `It is held in this run's changeset — a human will accept or reject it after you finish. ` +
      `Do not repeat it; continue with the rest of the task.`
    );
  }

  // auto: execute now, record with before/after, hand the real result back. The
  // mutation logs its activity_log row inside its own transaction; captureActivity
  // catches that row's id (out of band — it is not in the returned result) so the
  // agent_action links to the activity it produced (013).
  const { result, activityId } = await captureActivity(() => spec.execute());
  await recordAction({
    runId: ctx.runId,
    changesetId: null,
    tool: spec.tool,
    tier,
    input: spec.input,
    result,
    before,
    after: result ?? null,
    activityId,
  });
  return spec.describe(result);
}
