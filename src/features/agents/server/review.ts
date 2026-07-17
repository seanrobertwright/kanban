import { query, queryOne } from "@/shared/db/client";
import type { Principal } from "@/features/auth/server/principal";
import { AuthzError, requireTaskRole } from "@/features/workspaces/server/authz";
import {
  createTask,
  moveTask,
  updateTask,
} from "@/features/tasks/server/repository";
import type { Task } from "@/features/tasks/types";
import type { AgentActionView, RunDetail } from "../types";
import type { Tier } from "./gate";

/**
 * §7.4's changeset review — "a pull request for the board" — and the auto tier's
 * undo, on the server. The client renders the run's proposed diff; these are the
 * two verbs behind it: accept some/all/none of a changeset, and revert a single
 * auto-tier action.
 *
 * The reasoning that makes the two coherent: an accepted proposal RUNS now, as
 * the agent, through the same repository the agent would have used — so it writes
 * a real activity_log row attributed to the agent, and the board's audit trail
 * never distinguishes an accepted proposal from an action taken live. A reverted
 * auto action replays the inverse as the reverting HUMAN, because a human is the
 * one undoing it and the history should say so.
 */

interface RunRow {
  id: string;
  agentId: string;
  taskId: number | null;
  workspaceId: string;
  status: string;
  cost: string;
}

async function loadRun(runId: string): Promise<RunRow | undefined> {
  return queryOne<RunRow>(
    `SELECT id, agent_id AS "agentId", task_id AS "taskId",
            workspace_id AS "workspaceId", status, cost_micros AS cost
       FROM agent_run WHERE id = $1`,
    [runId]
  );
}

/**
 * A run with its action trail and pending changeset — what the review panel
 * reads. Viewer+, scoped through the run's task: seeing what an agent did to a
 * task is part of reading the task, the same access listActivityForTask grants.
 */
export async function getRunDetail(
  principal: string | Principal,
  runId: string
): Promise<RunDetail | undefined> {
  const run = await loadRun(runId);
  if (!run) return undefined;
  // A run always has a task in every path that reaches review; guard anyway.
  if (run.taskId !== null) await requireTaskRole(principal, run.taskId, "viewer");

  const actions = await query<AgentActionView>(
    `SELECT id, tool, tier, input, result, before, after,
            approved_by AS "approvedBy", reverted_at AS "revertedAt",
            created_at AS "createdAt"
       FROM agent_action WHERE run_id = $1 ORDER BY created_at`,
    [runId]
  );
  const changeset = await queryOne<{ id: string; status: string }>(
    `SELECT id, status FROM changeset WHERE run_id = $1`,
    [runId]
  );

  return {
    id: run.id,
    agentId: run.agentId,
    taskId: run.taskId,
    status: run.status,
    costMicros: Number(run.cost),
    actions,
    changeset: changeset ?? null,
  };
}

/**
 * The latest run for a task — what the task dialog shows so a human can review a
 * run's changeset or undo its auto actions. Null when the task has never had a
 * run. Viewer+, through getRunDetail.
 */
export async function getLatestRunForTask(
  principal: string | Principal,
  taskId: number
): Promise<RunDetail | null> {
  const row = await queryOne<{ id: string }>(
    `SELECT id FROM agent_run WHERE task_id = $1
      ORDER BY created_at DESC LIMIT 1`,
    [taskId]
  );
  if (!row) return null;
  return (await getRunDetail(principal, row.id)) ?? null;
}

/** Apply one accepted proposed action, as the agent, through the real repository
 *  — so it becomes a genuine, attributed board mutation. Only changeset-tier
 *  tools reach here (move/assign/create/create_subtask). */
async function applyProposed(
  agent: Extract<Principal, { kind: "agent" }>,
  action: { tool: string; input: unknown }
): Promise<void> {
  const input = action.input as Record<string, unknown>;
  switch (action.tool) {
    case "move_task":
      await moveTask(agent, input.id as number, {
        columnId: input.columnId as number,
        position: input.position as number,
      });
      return;
    case "assign_task":
      await updateTask(agent, input.id as number, {
        assignee: input.assignee as Task["assignee"],
      });
      return;
    case "create_task":
    case "create_subtask":
      await createTask(agent, input as never);
      return;
    default:
      // A tool that should never have been changeset-tiered; skip rather than
      // guess an inverse. The changeset review only offers what it proposed.
      return;
  }
}

/**
 * Accept some, all, or none of a run's changeset. Member+, scoped through the
 * task — triggering the agent's proposed writes is itself a board write. Rejected
 * proposals are simply left unapplied; the changeset records which was which.
 */
export async function reviewChangeset(
  principal: string | Principal,
  changesetId: string,
  acceptedActionIds: string[]
): Promise<RunDetail> {
  const cs = await queryOne<{ runId: string; status: string }>(
    `SELECT run_id AS "runId", status FROM changeset WHERE id = $1`,
    [changesetId]
  );
  if (!cs) throw new AuthzError("not_found", "Changeset not found");
  const run = await loadRun(cs.runId);
  if (!run || run.taskId === null) {
    throw new AuthzError("not_found", "Changeset not found");
  }
  const { workspaceId } = await requireTaskRole(principal, run.taskId, "member");
  if (cs.status !== "pending") {
    throw new AuthzError("conflict", "This changeset has already been reviewed");
  }

  const proposed = await query<{ id: string; tool: string; input: unknown }>(
    `SELECT id, tool, input FROM agent_action
      WHERE changeset_id = $1 AND tier = 'changeset'`,
    [changesetId]
  );

  const accept = new Set(acceptedActionIds);
  const agent = {
    kind: "agent" as const,
    agentId: run.agentId,
    workspaceId,
  };
  const reviewer =
    typeof principal === "string"
      ? principal
      : principal.kind === "human"
        ? principal.userId
        : principal.agentId;

  let accepted = 0;
  for (const action of proposed) {
    if (!accept.has(action.id)) continue;
    await applyProposed(agent, action);
    await query(`UPDATE agent_action SET approved_by = $2 WHERE id = $1`, [
      action.id,
      reviewer,
    ]);
    accepted += 1;
  }

  const status =
    accepted === 0
      ? "rejected"
      : accepted === proposed.length
        ? "accepted"
        : "partial";
  await query(
    `UPDATE changeset SET status = $2, reviewed_by = $3, reviewed_at = now()
      WHERE id = $1`,
    [changesetId, status, reviewer]
  );
  // The review resolves the run's awaiting_review state.
  await query(
    `UPDATE agent_run SET status = 'succeeded' WHERE id = $1 AND status = 'awaiting_review'`,
    [run.id]
  );

  return (await getRunDetail(principal, run.id))!;
}

/**
 * Undo one auto-tier board-state action — §7.4's "reversible for a window".
 * Replays the inverse from the action's `before` snapshot, as the reverting
 * human, so the history reads honestly ("Alice reverted the priority").
 *
 * Scoped to the board-state field edits (priority, labels, due date, rename),
 * whose inverse is "restore what the field was". Comments are deliberately not
 * here: a comment is an utterance, not reversible state (005's line), and
 * removing one is moderation with its own rules, not an undo.
 */
export async function revertAction(
  principal: string | Principal,
  actionId: string
): Promise<void> {
  const action = await queryOne<{
    tool: string;
    tier: Tier;
    before: Task | null;
    revertedAt: string | null;
    runId: string;
  }>(
    `SELECT tool, tier, before, reverted_at AS "revertedAt", run_id AS "runId"
       FROM agent_action WHERE id = $1`,
    [actionId]
  );
  if (!action) throw new AuthzError("not_found", "Action not found");
  if (action.tier !== "auto") {
    throw new AuthzError("conflict", "Only an auto-tier action can be undone");
  }
  if (action.revertedAt) {
    throw new AuthzError("conflict", "This action was already undone");
  }
  const before = action.before;
  if (!before) {
    throw new AuthzError("conflict", "This action has no state to restore");
  }
  // Member on the task — undoing an agent's edit is a board write.
  await requireTaskRole(principal, before.id, "member");

  switch (action.tool) {
    case "set_priority":
      await updateTask(principal, before.id, { priority: before.priority });
      break;
    case "set_due_date":
      await updateTask(principal, before.id, { dueDate: before.dueDate });
      break;
    case "set_labels":
      await updateTask(principal, before.id, {
        labelIds: before.labels.map((l) => l.id),
      });
      break;
    case "rename_task":
      await updateTask(principal, before.id, {
        title: before.title,
        description: before.description,
      });
      break;
    default:
      throw new AuthzError("conflict", `"${action.tool}" cannot be undone`);
  }

  await query(`UPDATE agent_action SET reverted_at = now() WHERE id = $1`, [
    actionId,
  ]);
}
