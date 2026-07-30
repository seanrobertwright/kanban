import { query, queryOne } from "@/shared/db/client";
import { principalActor, type Principal } from "@/features/auth/server/principal";
import {
  createObjective,
  updateKeyResult,
  updateObjective,
} from "@/features/objectives/server/repository";
import {
  AuthzError,
  requireTaskRole,
  requireWorkspaceRole,
} from "@/features/workspaces/server/authz";
import { captureActivity } from "@/features/activity/server/activity-capture";
import {
  claimTask,
  createTask,
  moveTask,
  releaseTask,
  updateTask,
} from "@/features/tasks/server/repository";
import { promoteIdea } from "@/features/discovery/server/repository";
import { createComment } from "@/features/comments/server/repository";
import {
  addDependency,
  removeDependency,
} from "@/features/dependencies/server/repository";
import { DEFAULT_LINK, type DependencyLink } from "@/features/dependencies/types";
import {
  createChecklistItem,
  updateChecklistItem,
} from "@/features/checklists/server/repository";
import { setTaskFieldValues } from "@/features/custom-fields/server/repository";
import { createEpic, updateEpic } from "@/features/epics/server/repository";
import type { EpicStatus } from "@/features/epics/types";
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
  // A native run always has a task; a Door-2 hold for a top-level create does
  // not (gate.ts holdForExternalReview), and scopes through its workspace.
  if (run.taskId !== null) {
    await requireTaskRole(principal, run.taskId, "viewer");
  } else {
    await requireWorkspaceRole(principal, run.workspaceId, "viewer");
  }

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

/**
 * The human-only rule behind the whole changeset tier.
 *
 * Both review verbs resolve their caller with getPrincipalFromRequest, so an
 * agent key reaches them — and an agent that can accept its own changeset makes
 * the 202 "a human will accept or reject it" a lie, and the changeset tier
 * decorative. gate.ts blocks review_changeset and revert_action by default, but
 * that is a policy an operator can override; this is the invariant, checked at
 * the repository so BOTH doors and any future caller inherit it.
 */
function requireHumanReviewer(principal: string | Principal): void {
  if (typeof principal !== "string" && principal.kind === "agent") {
    throw new AuthzError(
      "forbidden",
      "Only a person can review an agent's changeset — that review is what the approval gate is for"
    );
  }
}

/** Apply one accepted proposed action, as the agent, through the real repository
 *  — so it becomes a genuine, attributed board mutation. Returns whether it was
 *  applied: an unknown tool is NOT, and must not be counted as accepted. */
async function applyProposed(
  agent: Extract<Principal, { kind: "agent" }>,
  action: { tool: string; input: unknown }
): Promise<boolean> {
  const input = action.input as Record<string, unknown>;
  switch (action.tool) {
    case "move_task":
      await moveTask(agent, input.id as number, {
        columnId: input.columnId as number,
        position: input.position as number,
      });
      return true;
    case "assign_task":
      await updateTask(agent, input.id as number, {
        assignee: input.assignee as Task["assignee"],
      });
      return true;
    case "create_task":
    case "create_subtask":
      await createTask(agent, input as never);
      return true;
    case "promote_idea":
      await promoteIdea(agent, input.ideaId as number);
      return true;
    // The auto-tier tools appear here because a tier is a POLICY, not a property
    // of the tool: an admin who raises comment_on_task to changeset for a
    // particular agent (012) must get a proposal that can actually be accepted.
    // Without these, raising the tier would silently turn the tool off — held
    // forever, unappliable — which is a worse answer than either tier.
    case "comment_on_task":
      await createComment(agent, {
        taskId: input.taskId as number,
        body: input.body as string,
        parentId: input.parentId as number | undefined,
      });
      return true;
    // The two doors name the blocked task differently in the input they record —
    // Door 1 as `id` (tools.ts), Door 2 as `taskId` (dependencies handlers) — so
    // reading only one of them applied a Door-1 proposal with an undefined task
    // id, and a throw mid-review abandons every other action in the changeset.
    // The link (087) is read for the same reason it is recorded: accepting
    // "starts with #42, two days in" must not apply a plain finish-to-start edge.
    case "flag_blocker":
      await addDependency(
        agent,
        (input.taskId ?? input.id) as number,
        input.dependsOnId as number,
        {
          type: (input.type as DependencyLink["type"]) ?? DEFAULT_LINK.type,
          lagDays: (input.lagDays as number) ?? DEFAULT_LINK.lagDays,
        }
      );
      return true;
    case "unflag_blocker":
      await removeDependency(
        agent,
        (input.taskId ?? input.id) as number,
        input.dependsOnId as number
      );
      return true;
    // Claiming is auto by tier and here for the reason the block above states —
    // a tier is policy. An operator who raises claim_task for a particular agent
    // wants the hold held for review, not turned off. The lease rides the input
    // (076): a proposal to hold a task for a working day is a different proposal
    // from one to hold it an hour, and accepting it must mean what it said.
    case "claim_task":
      await claimTask(agent, input.id as number, input.ttlMinutes as number | undefined);
      return true;
    case "release_task":
      await releaseTask(agent, input.id as number);
      return true;
    case "add_checklist_item":
      await createChecklistItem(agent, input.taskId as number, {
        content: input.content as string,
      });
      return true;
    case "check_item":
      await updateChecklistItem(agent, input.itemId as number, {
        content: input.content as string | undefined,
        done: input.done as boolean | undefined,
      });
      return true;
    case "set_objective":
      // One tool, two shapes, because "set" is what the agent asked for and the
      // presence of an id is the whole difference. The recorded input carries
      // boardId on a create precisely so this can run without the request that
      // proposed it.
      if (input.id === undefined) {
        await createObjective(
          agent,
          input.boardId as number,
          {
            name: input.name as string,
            description: input.description as string | undefined,
            dueDate: input.dueDate as string | null | undefined,
          },
          principalActor(agent)
        );
      } else {
        await updateObjective(
          agent,
          input.id as number,
          {
            name: input.name as string | undefined,
            description: input.description as string | undefined,
            ...("dueDate" in input ? { dueDate: input.dueDate as string | null } : {}),
          },
          principalActor(agent)
        );
      }
      return true;
    case "set_epic":
      // set_objective's two shapes, one migration over (089): the presence of an
      // id is the whole difference, and the recorded input carries boardId on a
      // create so this runs without the request that proposed it. ownerId is
      // three-valued, so `"ownerId" in input` — not a null check — is what
      // separates "leave the owner" from "un-own it", dueDate's rule above.
      if (input.id === undefined) {
        await createEpic(
          agent,
          input.boardId as number,
          {
            name: input.name as string,
            status: input.status as EpicStatus | undefined,
            ownerId: (input.ownerId as string | null | undefined) ?? null,
          },
          principalActor(agent)
        );
      } else {
        await updateEpic(
          agent,
          input.id as number,
          {
            name: input.name as string | undefined,
            status: input.status as EpicStatus | undefined,
            ...("ownerId" in input
              ? { ownerId: input.ownerId as string | null }
              : {}),
          },
          principalActor(agent)
        );
      }
      return true;
    // Auto-tier by default, and here for the same reason the other auto tools
    // are: an admin who raises it for one agent must get a proposal that can
    // actually be accepted.
    case "assign_to_epic":
      await updateTask(agent, input.id as number, {
        epicId: input.epicId as number | null,
      });
      return true;
    case "score_key_result":
      await updateKeyResult(agent, input.id as number, {
        currentValue: input.currentValue as number,
      });
      return true;
    case "set_custom_fields":
      await setTaskFieldValues(
        agent,
        input.taskId as number,
        input.values as { fieldId: number; value: string | null }[]
      );
      return true;
    default:
      // A tool held at changeset tier with no inverse here — reachable only by
      // an operator policy override naming a tool this switch does not know.
      // Skipping is the safe half; the other half is NOT marking it approved,
      // because a reviewer who clicked accept and got nothing should see it
      // still pending rather than a false record that it ran.
      return false;
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
  requireHumanReviewer(principal);
  const cs = await queryOne<{ runId: string; status: string }>(
    `SELECT run_id AS "runId", status FROM changeset WHERE id = $1`,
    [changesetId]
  );
  if (!cs) throw new AuthzError("not_found", "Changeset not found");
  const run = await loadRun(cs.runId);
  if (!run) throw new AuthzError("not_found", "Changeset not found");
  // A task-less run is a Door-2 hold for a top-level create (gate.ts): there is
  // no task to scope through yet — the create is the thing under review — so
  // membership in the run's workspace is the write-rank check instead.
  if (run.taskId !== null) {
    await requireTaskRole(principal, run.taskId, "member");
  } else {
    await requireWorkspaceRole(principal, run.workspaceId, "member");
  }
  const workspaceId = run.workspaceId;
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
    // A changeset action mutates for the first time here, at accept — so this is
    // where its activity_log row is born, and where its agent_action finally links
    // to it (013). captureActivity catches the id the applied mutation logs.
    const { result: applied, activityId } = await captureActivity(() =>
      applyProposed(agent, action)
    );
    if (!applied) continue;
    await query(
      `UPDATE agent_action SET approved_by = $2, activity_id = $3 WHERE id = $1`,
      [action.id, reviewer, activityId]
    );
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
  // An undo is a human's correction of an agent, and the history says so (the
  // inverse is replayed as the reverting human). An agent undoing its own auto
  // action would both launder the attribution and hand it a second write it was
  // never gated for.
  requireHumanReviewer(principal);
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
