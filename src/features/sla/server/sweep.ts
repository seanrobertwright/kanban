import { query } from "@/shared/db/client";
import { evaluate, planActions, type Snapshot } from "@/features/automations/lib/engine";
import { applyEffects } from "@/features/automations/server/runner";
import type { Action, Condition } from "@/features/automations/types";

/**
 * SLA sweep (050, rock 1.6) — the timer engine, ridden by the durable drainer on
 * the same tick as scheduled automations. Two passes:
 *
 *   1. start — every enabled policy scans its board and opens a timer (due
 *      target_mins out) for each matching task that has none yet.
 *   2. breach — every open timer now past due is stamped breached_at (once) and
 *      its policy's action_on_breach is applied to the task.
 *
 * Elapsed/remaining are never stored — only the three timestamps are (the
 * derive-don't-store rule); the API computes the rest.
 */

interface PolicyRow {
  id: number;
  boardId: number;
  appliesWhen: Condition;
  targetMins: number;
  createdBy: string;
}

async function startTimers(): Promise<void> {
  const policies = await query<PolicyRow>(
    `SELECT id, board_id AS "boardId", applies_when AS "appliesWhen",
            target_mins AS "targetMins", created_by AS "createdBy"
       FROM sla_policy WHERE is_enabled`
  );
  if (policies.length === 0) return;
  const { getBoard } = await import("@/features/board/server/repository");

  for (const policy of policies) {
    const board = await getBoard(policy.createdBy, policy.boardId);
    for (const task of board?.tasks ?? []) {
      if (!evaluate(policy.appliesWhen, task as unknown as Snapshot)) continue;
      // ON CONFLICT DO NOTHING: one timer per (task, policy) — a task already
      // being timed is left as-is, so re-scanning does not reset its clock.
      await query(
        `INSERT INTO task_sla (task_id, policy_id, due_at)
         VALUES ($1, $2, now() + ($3 * interval '1 minute'))
         ON CONFLICT (task_id, policy_id) DO NOTHING`,
        [task.id, policy.id, policy.targetMins]
      );
    }
  }
}

async function breachTimers(): Promise<void> {
  // Claim each overdue-open timer by stamping breached_at in the same UPDATE that
  // selects it, so two overlapping sweeps cannot both fire the breach action.
  const breached = await query<{
    taskId: number;
    actionOnBreach: Action[];
    createdBy: string;
  }>(
    `UPDATE task_sla ts
        SET breached_at = now()
       FROM sla_policy p
      WHERE ts.policy_id = p.id
        AND ts.breached_at IS NULL
        AND ts.due_at <= now()
      RETURNING ts.task_id AS "taskId",
                p.action_on_breach AS "actionOnBreach",
                p.created_by AS "createdBy"`
  );
  if (breached.length === 0) return;
  const { getTask } = await import("@/features/tasks/server/repository");

  for (const row of breached) {
    if (!row.actionOnBreach?.length) continue;
    // Per-row guard: the timer is already stamped breached (the UPDATE above), so
    // one policy's bad escalation action must not abort the rest of the sweep.
    try {
      const task = await getTask(row.createdBy, row.taskId);
      if (!task) continue;
      const snapshot = task as unknown as Snapshot;
      const effects = planActions(row.actionOnBreach, snapshot);
      await applyEffects(row.createdBy, row.taskId, effects, snapshot);
    } catch (error) {
      console.error(`sla breach action failed for task ${row.taskId}`, error);
    }
  }
}

/** One SLA tick: start new timers, then breach overdue ones. */
export async function sweepSlas(): Promise<void> {
  await startTimers();
  await breachTimers();
}
