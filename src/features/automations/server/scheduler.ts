import type { Snapshot } from "../lib/engine";
import { evaluate, planActions } from "../lib/engine";
import {
  advanceSchedule,
  dueScheduledRules,
  recordScheduledRun,
} from "./repository";
import { applyEffects } from "./runner";

/**
 * Recurring automation rules (047, rock 1.4). A schedule.tick rule has no
 * triggering event — it fires on a timer and *scans* the board, applying its
 * actions to every task its conditions match. This tick is called by the durable
 * run-queue drainer (drainer.ts) on the same sweep that recovers agent runs, so
 * 1.4 adds no second worker.
 *
 * A due rule loads its board (as the rule's author, so its scan honors the same
 * access a human would have), evaluates against each task — a Task's fields ARE a
 * snapshot for the evaluator — and applies effects to the matches, then advances
 * next_run_at to the next slot from now (catch up, don't replay missed ticks).
 */
export async function tickScheduledAutomations(): Promise<number> {
  const rules = await dueScheduledRules();
  let fired = 0;
  // Deferred import breaks the static cycle (board repo → … → this module's
  // runner import), the runner's own discipline.
  const { getBoard } = await import("@/features/board/server/repository");

  for (const rule of rules) {
    try {
      const board = await getBoard(rule.createdBy, rule.boardId);
      const tasks = board?.tasks ?? [];
      let matched = 0;
      for (const task of tasks) {
        const snapshot = task as unknown as Snapshot;
        if (!evaluate(rule.conditions, snapshot)) continue;
        const effects = planActions(rule.actions, snapshot);
        await applyEffects(rule.createdBy, task.id, effects, snapshot);
        matched += 1;
      }
      await recordScheduledRun(rule.id, "matched", { matched });
      fired += 1;
    } catch (error) {
      await recordScheduledRun(rule.id, "error", {
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      // Advance regardless of outcome so a persistently failing rule does not
      // spin every tick — its error is logged, and it retries next slot.
      await advanceSchedule(rule.id, rule.every);
    }
  }
  return fired;
}
