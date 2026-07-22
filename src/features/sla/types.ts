/**
 * SLA management (050, rock 1.6). A policy times the tasks its `appliesWhen`
 * condition matches: each such task gets a timer due `targetMins` after it
 * started, and when the timer breaches the policy's `actionOnBreach` runs
 * (notify/escalate/label — the automation engine's actions). Elapsed and
 * remaining are derived from the timestamps, never stored.
 */

import type { Action, Condition } from "@/features/automations/types";

export interface SlaPolicy {
  id: number;
  boardId: number;
  name: string;
  appliesWhen: Condition;
  targetMins: number;
  actionOnBreach: Action[];
  isEnabled: boolean;
  createdAt: string;
}

export interface CreateSlaPolicyInput {
  name: string;
  appliesWhen?: Condition;
  targetMins: number;
  actionOnBreach?: Action[];
  isEnabled?: boolean;
}

export interface UpdateSlaPolicyInput {
  name?: string;
  appliesWhen?: Condition;
  targetMins?: number;
  actionOnBreach?: Action[];
  isEnabled?: boolean;
}

/** A task's live timer for one policy, with its derived state. */
export interface TaskSlaStatus {
  policyId: number;
  policyName: string;
  startedAt: string;
  dueAt: string;
  breachedAt: string | null;
  /** Minutes until due (negative once overdue) — derived, see slaRemainingMins. */
  remainingMins: number;
  breached: boolean;
}

/**
 * Minutes remaining until a timer is due — positive before, negative after.
 * Pure so the same math backs the API's derived field and its test; the caller
 * passes `now` (ms) so it is deterministic.
 */
export function slaRemainingMins(dueAtMs: number, nowMs: number): number {
  return Math.round((dueAtMs - nowMs) / 60000);
}

/** A timer has breached when it carries a breach stamp or now is past due. */
export function slaBreached(
  breachedAt: string | null,
  dueAtMs: number,
  nowMs: number
): boolean {
  return breachedAt !== null || nowMs >= dueAtMs;
}
