import { AsyncLocalStorage } from "node:async_hooks";

import { query } from "@/shared/db/client";
import type { UpdateTaskInput } from "@/features/tasks/types";
import type { Effect, Snapshot } from "../lib/engine";
import { evaluate, planActions } from "../lib/engine";
import {
  claimRun,
  finishRun,
  rulesForDispatch,
  type DispatchRow,
} from "./repository";

/**
 * The runner — the automation engine's execution arm (045). It is a *second
 * subscriber* on the same post-commit sink webhooks ride: logActivity calls
 * queueAutomations right beside queueDelivery, so a rule fires on exactly the
 * events a webhook would, and the delivery re-reads the committed activity row
 * first (the receipt) so a rolled-back mutation triggers nothing.
 *
 * Two guards keep a rule that acts on the board from stampeding it:
 *
 *  • Idempotency — claimRun writes an automation_run row under a UNIQUE(rule,
 *    activity) constraint, so a redelivered event cannot double-fire a rule.
 *  • Cascade depth cap — an action (move, set_field) itself logs activity, which
 *    re-enters this runner. The depth is carried across the post-commit boundary
 *    in AsyncLocalStorage and capped, so "when moved, move" cannot recurse
 *    forever (planActions already elides the commonest self-move; this is the
 *    backstop for genuine A→B→A rule chains).
 */

const MAX_CASCADE_DEPTH = 5;

/** Carries the current cascade depth through the applied repository calls so the
 *  nested logActivity → queueAutomations they trigger captures depth + 1. */
const cascadeDepth = new AsyncLocalStorage<number>();

/**
 * Queues the engine for one activity, post-commit — the twin of queueDelivery,
 * and it fails the same way on purpose: outside a request scope (a test, a
 * script) after() throws and nothing is queued, so a test drives
 * runAutomationsForActivity directly. The depth is read from the ambient
 * cascade context (0 at the top of a chain) and advanced by one for the child.
 */
export function queueAutomations(activityId: string): void {
  const nextDepth = (cascadeDepth.getStore() ?? 0) + 1;
  void (async () => {
    try {
      const { after } = await import("next/server");
      after(() => runAutomationsForActivity(activityId, nextDepth));
    } catch {
      // No request scope — no run. See queueDelivery.
    }
  })();
}

interface ActivityRow {
  boardId: number | null;
  taskId: number | null;
  action: string;
  after: unknown;
}

/**
 * Runs every enabled rule subscribed to one activity's event. Re-reads the
 * committed row first (the receipt), dispatches by (board, event), and for each
 * rule: claims it (idempotency), evaluates its conditions against the event's
 * `after` snapshot, and — if they hold — applies its planned effects as the
 * rule's author, logging the outcome to automation_run.
 */
export async function runAutomationsForActivity(
  activityId: string,
  depth = 0
): Promise<void> {
  const rows = await query<ActivityRow>(
    `SELECT board_id AS "boardId", task_id AS "taskId", action, after
       FROM activity_log WHERE id = $1`,
    [activityId]
  );
  const entry = rows[0];
  // The engine only acts on task events carrying a board and a snapshot to test.
  if (!entry || entry.boardId == null || entry.taskId == null) return;
  if (!entry.action.startsWith("task.")) return;
  const snapshot = (entry.after ?? {}) as Snapshot;

  const rules = await rulesForDispatch(entry.boardId, entry.action);
  for (const rule of rules) {
    // Idempotency: a redelivered activity's second claim conflicts → skip.
    if (!(await claimRun(rule.id, activityId))) continue;

    if (depth > MAX_CASCADE_DEPTH) {
      await finishRun(rule.id, activityId, "capped", { depth });
      continue;
    }
    if (!evaluate(rule.conditions, snapshot)) {
      await finishRun(rule.id, activityId, "skipped", { reason: "conditions" });
      continue;
    }

    const effects = planActions(rule.actions, snapshot);
    try {
      await cascadeDepth.run(depth, () =>
        applyEffects(rule, entry.taskId!, effects, snapshot)
      );
      await finishRun(rule.id, activityId, "matched", { effects });
    } catch (error) {
      await finishRun(rule.id, activityId, "error", {
        message: error instanceof Error ? error.message : String(error),
        effects,
      });
    }
  }
}

/**
 * Applies a rule's effects to its task, in order, each through the ordinary
 * repository as the rule's author (created_by). That is the whole safety story:
 * the engine holds no elevated door — a move it makes runs moveTask's tenancy
 * and role checks, a set_field runs updateTask's, so an automation can do
 * exactly what its (admin) author could do by hand and no more.
 */
async function applyEffects(
  rule: DispatchRow,
  taskId: number,
  effects: Effect[],
  snapshot: Snapshot
): Promise<void> {
  const by = rule.createdBy;
  // Dynamically imported so the static graph stays acyclic: these repositories
  // import the activity log, which imports this runner (queueAutomations). The
  // cycle is only a problem at module-eval time — deferring the import to first
  // apply breaks it, the same shape queueDelivery uses for next/server.
  const { moveTask, updateTask } = await import(
    "@/features/tasks/server/repository"
  );
  const { createComment } = await import(
    "@/features/comments/server/repository"
  );
  for (const effect of effects) {
    switch (effect.type) {
      case "move":
        // Append to the end of the target column: moveTask clamps position to
        // the sibling count, so a large sentinel lands the task last rather than
        // making the engine count rows itself.
        await moveTask(by, taskId, {
          columnId: effect.columnId,
          position: Number.MAX_SAFE_INTEGER,
        });
        break;
      case "assign":
        await updateTask(by, taskId, { assignee: effect.assignee });
        break;
      case "set_field":
        await updateTask(by, taskId, {
          [effect.field]: effect.value,
        } as UpdateTaskInput);
        break;
      case "add_label": {
        // updateTask replaces the whole label set, so union the new id onto the
        // task's current labels (carried on the event snapshot as [{labelId}]).
        // Re-adding an existing label is a no-op set.
        const current = Array.isArray(snapshot.labels)
          ? (snapshot.labels as Array<{ labelId?: number }>)
              .map((l) => l.labelId)
              .filter((id): id is number => typeof id === "number")
          : [];
        const labelIds = Array.from(new Set([...current, effect.labelId]));
        await updateTask(by, taskId, { labelIds });
        break;
      }
      case "comment":
        await createComment(by, { taskId, body: effect.body });
        break;
    }
  }
}
