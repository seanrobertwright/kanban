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
 *               labels, due date, estimate, type, milestone, score, rename,
 *               custom-field answers, checklist steps), and flagging or
 *               unflagging a blocked-by edge
 *               (018's dependency: silent, idempotent, reversible by removal).
 *   changeset — the consequential moves §7.4 names by name: status (move),
 *               reassignment (assign), decomposition (create task/subtask, and
 *               promoting an idea, which is a create wearing another name).
 *   block     — the things that are not board state at all: spending the
 *               workspace's model budget, and the human approval itself.
 *
 * The destructive board tools (delete, archive) are absent rather than blocked,
 * because they are not exposed to the agent at all — the same cut Door 2 makes
 * (mcp/README.md). A tool the agent cannot call needs no gate.
 *
 * The table has to be COMPLETE for every tool an agent can reach, not merely
 * correct where it is filled in: tierFor falls through to 'changeset', so an
 * unnamed mutating tool is held rather than run — safe, but it also means a
 * missing entry silently changes an endpoint's behaviour rather than failing.
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
  score_task: "auto",
  aim_at_milestone: "auto",
  rename_task: "auto",
  flag_blocker: "auto",
  unflag_blocker: "auto",
  add_checklist_item: "auto",
  check_item: "auto",
  set_custom_fields: "auto",
  assign_task: "changeset",
  move_task: "changeset",
  create_task: "changeset",
  create_subtask: "changeset",
  promote_idea: "changeset",
  // Not board state, and that is exactly why they are blocked rather than held.
  // Starting a run spends the workspace's budget on a model; reviewing a
  // changeset or reverting an action IS the human approval §7.4 is built around.
  // An agent that could do either could approve its own proposals, which would
  // make the changeset tier decorative. review.ts refuses these a second time at
  // the repository, so a policy override cannot re-open the door.
  start_run: "block",
  review_changeset: "block",
  revert_action: "block",
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
 * §7.1/§7.4 parity for Door 2 — the external-agent HTTP door.
 *
 * The native runtime threads every tool call through gate() above, but an
 * external agent's mutations arrive as plain HTTP handled by the shared task
 * handlers, which used to apply them immediately — bypassing the approval
 * model the PRD says both doors share. These two functions are the seam the
 * handlers call: `externalAgentTier` answers "what tier would this action run
 * under for this agent", and `holdForExternalReview` parks the changeset-tier
 * ones in the SAME run/changeset/action machinery a native run uses, so the
 * existing review endpoint (reviewChangeset) applies or rejects them with no
 * new moving parts.
 *
 * A Door-2 "run" is synthetic — one held HTTP request, status
 * 'awaiting_review', zero tokens — because 013 hangs a changeset off a run and
 * UNIQUE(run_id) allows nothing else. That is honest enough: the run records
 * which agent proposed what, which is all review needs.
 */

interface ExternalAgentGate {
  /** The agent's per-tool overrides (012), gaps falling to DEFAULT_TIER. */
  policy: Partial<Record<string, Tier>>;
}

async function loadExternalGate(
  principal: Extract<Principal, { kind: "agent" }>
): Promise<ExternalAgentGate> {
  const row = await queryOne<{ policy: Partial<Record<string, Tier>> | null }>(
    `SELECT approval_policy AS policy FROM agent WHERE id = $1`,
    [principal.agentId]
  );
  return { policy: row?.policy ?? {} };
}

/** The tier a named tool would run under for an external agent — tierFor with
 *  the agent's stored policy, no RunContext required. */
export async function externalAgentTier(
  principal: Extract<Principal, { kind: "agent" }>,
  tool: string
): Promise<Tier> {
  const { policy } = await loadExternalGate(principal);
  return policy[tool] ?? DEFAULT_TIER[tool] ?? "changeset";
}

/** One proposed action a Door-2 request wants held. `taskId` names the task it
 *  targets (for the reviewer's before snapshot); null for a create. */
export interface HeldAction {
  tool: string;
  input: unknown;
  taskId: number | null;
}

/**
 * Parks a Door-2 request's changeset-tier actions for human review: one
 * synthetic run, its one changeset, one agent_action per held mutation —
 * exactly the rows a native run's gate() writes, so reviewChangeset needs no
 * special case. Returns the ids the 202 response carries back to the agent.
 *
 * `anchorTaskId` is the task the run hangs off — the target of a move/assign,
 * the parent of a subtask — so the hold surfaces in that task's dialog like a
 * native run's would. A top-level create has no task to anchor to and passes
 * null; its changeset is reviewable by id (the review path scopes a task-less
 * run through the workspace instead).
 */
export async function holdForExternalReview(
  principal: Extract<Principal, { kind: "agent" }>,
  actions: HeldAction[],
  anchorTaskId: number | null
): Promise<{ runId: string; changesetId: string }> {
  const runId = randomUUID();
  await query(
    `INSERT INTO agent_run (id, agent_id, task_id, workspace_id, status)
     VALUES ($1, $2, $3, $4, 'awaiting_review')`,
    [runId, principal.agentId, anchorTaskId, principal.workspaceId]
  );
  const ctx: RunContext = {
    runId,
    principal,
    policy: {},
    changesetId: null,
  };
  const changesetId = await ensureChangeset(ctx);
  for (const action of actions) {
    const before =
      action.taskId === null
        ? null
        : (await getTask(principal, action.taskId)) ?? null;
    await recordAction({
      runId,
      changesetId,
      tool: action.tool,
      tier: "changeset",
      input: action.input,
      result: null,
      before,
      after: null,
    });
  }
  return { runId, changesetId };
}

/**
 * What a Door-2 mutation resolved to. Deliberately not a Response: the gate is a
 * repository-layer seam and knows nothing about HTTP — door2.ts turns the two
 * refusals into their 202/403 answers, and the handler shapes its own success.
 */
export type ExternalOutcome<T> =
  | { kind: "done"; result: T }
  | { kind: "blocked"; tool: string }
  | { kind: "held"; runId: string; changesetId: string };

/**
 * One Door-2 mutation, through the same three tiers a native run uses. This is
 * gate() for the HTTP door: `execute` runs ONLY on the auto tier, a changeset
 * tier parks a proposal, and block refuses.
 *
 * The auto tier records too, which Door 2 previously did not. A native run
 * writes an agent_action for every auto call — that row is the audit line and
 * the thing undo replays from — so an external agent's comment that wrote no row
 * was invisible to both. The synthetic run is the same fiction
 * holdForExternalReview already tells: one HTTP request, zero tokens, terminal
 * on arrival because there is no loop to keep turning.
 *
 * `authorize` runs before a proposal is minted, for the same reason
 * handleCreateTask checks the column first: a changeset a reviewer could never
 * accept is worse than a refusal now.
 */
export async function externalAgentAction<T>(
  principal: Extract<Principal, { kind: "agent" }>,
  spec: {
    tool: string;
    input: unknown;
    /** The task this targets, for the before snapshot. Null when there is none
     *  yet (a create) or the action is not about a task. */
    taskId: number | null;
    /** The task a held run hangs off, if different from `taskId`. */
    anchorTaskId?: number | null;
    authorize?: () => Promise<void>;
    execute: () => Promise<T>;
  }
): Promise<ExternalOutcome<T>> {
  const tier = await externalAgentTier(principal, spec.tool);
  if (tier === "block") return { kind: "blocked", tool: spec.tool };

  if (tier === "changeset") {
    if (spec.authorize) await spec.authorize();
    const held = await holdForExternalReview(
      principal,
      [{ tool: spec.tool, input: spec.input, taskId: spec.taskId }],
      spec.anchorTaskId !== undefined ? spec.anchorTaskId : spec.taskId
    );
    return { kind: "held", ...held };
  }

  // auto: the mutation runs now, and its own authz inside the repository is the
  // real check — `authorize` is only needed on the path that does NOT execute.
  const before =
    spec.taskId === null
      ? null
      : (await getTask(principal, spec.taskId)) ?? null;
  const { result, activityId } = await captureActivity(() => spec.execute());

  const runId = randomUUID();
  await query(
    `INSERT INTO agent_run (id, agent_id, task_id, workspace_id, status)
     VALUES ($1, $2, $3, $4, 'succeeded')`,
    [runId, principal.agentId, spec.taskId, principal.workspaceId]
  );
  await recordAction({
    runId,
    changesetId: null,
    tool: spec.tool,
    tier,
    input: spec.input,
    result,
    before,
    after: result ?? null,
    activityId,
  });
  return { kind: "done", result };
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
