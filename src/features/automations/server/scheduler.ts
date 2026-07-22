import type { Snapshot } from "../lib/engine";
import { evaluate, planActions } from "../lib/engine";
import {
  advanceSchedule,
  dueScheduledRules,
  recordScheduledRun,
  rulesForDispatch,
  type DispatchRow,
} from "./repository";
import { applyEffects } from "./runner";

/**
 * Runs one rule as a *board scan*: load its board (as the rule's author, so the
 * scan honors the same access a human would), evaluate against every task — a
 * Task's fields ARE a snapshot for the evaluator — and apply the rule's effects
 * to the matches. Returns how many tasks matched. Shared by the timer-driven
 * scheduler (1.4) and the externally-triggered endpoint (1.12): both need "act on
 * every task this rule matches right now", they differ only in what woke them.
 */
async function scanBoardWithRule(rule: DispatchRow): Promise<number> {
  const { getBoard } = await import("@/features/board/server/repository");
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
  return matched;
}

/**
 * Fires every enabled external.trigger rule on a board (1.12) — the inbound arm.
 * An external tool POSTing to a board's trigger token drives the board through
 * this: each matching rule scans and acts, and each fire is logged. Returns how
 * many rules ran.
 */
export async function fireExternalTrigger(boardId: number): Promise<number> {
  const rules = await rulesForDispatch(boardId, "external.trigger");
  let fired = 0;
  for (const rule of rules) {
    try {
      const matched = await scanBoardWithRule(rule);
      await recordScheduledRun(rule.id, "matched", { matched, via: "external" });
      fired += 1;
    } catch (error) {
      await recordScheduledRun(rule.id, "error", {
        message: error instanceof Error ? error.message : String(error),
        via: "external",
      });
    }
  }
  return fired;
}

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

  for (const rule of rules) {
    try {
      const matched = await scanBoardWithRule(rule);
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
