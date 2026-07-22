import { randomBytes } from "node:crypto";

import type { PoolClient } from "pg";

import type { Principal } from "@/features/auth/server/principal";
import { query, queryOne, withTransaction } from "@/shared/db/client";
import {
  AuthzError,
  requireBoardRole,
} from "@/features/workspaces/server/authz";
import type {
  AutomationRule,
  AutomationRun,
  AutomationRunStatus,
  AutomationTrigger,
  CreateAutomationRuleInput,
  UpdateAutomationRuleInput,
} from "../types";

/**
 * Automation engine (045) — persistence + authz. A rule *acts as* the workspace
 * (its actions move tasks, comment, reassign — blast radius), so authoring is
 * admin, matching the §7.4 rule that structural/blast-radius changes are admin;
 * reads are viewer+ (seeing what a board automates is part of seeing the board).
 *
 * The runner (runner.ts) reaches past this authz on the dispatch/record path: it
 * runs post-commit as the engine, not on behalf of a caller, so the functions it
 * uses take no principal and are marked internal below. The gate it honors is the
 * one that matters — the *actions* apply as the rule's `created_by`, through the
 * ordinary repositories, so an automation can never exceed its author.
 */

const RULE_COLUMNS = `id, board_id AS "boardId", name, is_enabled AS "isEnabled",
                      trigger, conditions, actions,
                      created_by AS "createdBy", created_at AS "createdAt"`;

async function selectRule(
  client: PoolClient,
  id: number
): Promise<AutomationRule | undefined> {
  const { rows } = await client.query<AutomationRule>(
    `SELECT ${RULE_COLUMNS} FROM automation_rule WHERE id = $1`,
    [id]
  );
  return rows[0];
}

export async function listAutomationRules(
  actor: string | Principal,
  boardId: number
): Promise<AutomationRule[]> {
  await requireBoardRole(actor, boardId, "viewer");
  return query<AutomationRule>(
    `SELECT ${RULE_COLUMNS} FROM automation_rule WHERE board_id = $1
      ORDER BY name, id`,
    [boardId]
  );
}

export async function createAutomationRule(
  userId: string,
  boardId: number,
  input: CreateAutomationRuleInput
): Promise<AutomationRule> {
  await requireBoardRole(userId, boardId, "admin");
  return withTransaction(async (client) => {
    // A schedule.tick rule is due immediately on creation; an event rule has no
    // schedule (NULL). now() is stated in SQL rather than passed as a param.
    const scheduled = input.trigger.event === "schedule.tick";
    const { rows } = await client.query<{ id: number }>(
      `INSERT INTO automation_rule
         (board_id, name, is_enabled, trigger, conditions, actions, created_by,
          next_run_at)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7,
               ${scheduled ? "now()" : "NULL"})
       RETURNING id`,
      [
        boardId,
        input.name.trim(),
        input.isEnabled ?? true,
        JSON.stringify(input.trigger),
        JSON.stringify(input.conditions ?? {}),
        JSON.stringify(input.actions ?? []),
        userId,
      ]
    );
    return (await selectRule(client, rows[0].id))!;
  });
}

/** Resolves a rule's board and proves the caller's rank there (forms' rule). */
async function requireRule(
  userId: string,
  id: number,
  min: "admin" | "viewer"
): Promise<{ boardId: number }> {
  const row = await queryOne<{ boardId: number }>(
    `SELECT board_id AS "boardId" FROM automation_rule WHERE id = $1`,
    [id]
  );
  if (!row) throw new AuthzError("not_found", "Automation not found");
  await requireBoardRole(userId, row.boardId, min);
  return { boardId: row.boardId };
}

export async function updateAutomationRule(
  userId: string,
  id: number,
  input: UpdateAutomationRuleInput
): Promise<AutomationRule | undefined> {
  await requireRule(userId, id, "admin");
  return withTransaction(async (client) => {
    const before = await selectRule(client, id);
    if (!before) return undefined;

    const setsTrigger = input.trigger !== undefined;
    const setsConditions = input.conditions !== undefined;
    const setsActions = input.actions !== undefined;
    // When the trigger changes: a schedule.tick rule gains a due time (keep the
    // existing one if it already had one, else now()); any other event clears it.
    await client.query(
      `UPDATE automation_rule
          SET name = COALESCE($2, name),
              is_enabled = COALESCE($3, is_enabled),
              trigger = CASE WHEN $4::boolean THEN $5::jsonb ELSE trigger END,
              conditions = CASE WHEN $6::boolean THEN $7::jsonb ELSE conditions END,
              actions = CASE WHEN $8::boolean THEN $9::jsonb ELSE actions END,
              next_run_at = CASE
                WHEN $4::boolean AND $5::jsonb->>'event' = 'schedule.tick'
                  THEN COALESCE(next_run_at, now())
                WHEN $4::boolean THEN NULL
                ELSE next_run_at END
        WHERE id = $1`,
      [
        id,
        input.name?.trim() ?? null,
        input.isEnabled ?? null,
        setsTrigger,
        setsTrigger ? JSON.stringify(input.trigger) : null,
        setsConditions,
        setsConditions ? JSON.stringify(input.conditions) : null,
        setsActions,
        setsActions ? JSON.stringify(input.actions) : null,
      ]
    );
    return (await selectRule(client, id))!;
  });
}

export async function deleteAutomationRule(
  userId: string,
  id: number
): Promise<boolean> {
  await requireRule(userId, id, "admin");
  await query(`DELETE FROM automation_rule WHERE id = $1`, [id]);
  return true;
}

const RUN_COLUMNS = `id, rule_id AS "ruleId", activity_id AS "activityId",
                     status, detail, created_at AS "createdAt"`;

const RUN_LOG_LIMIT = 50;

/** The rule's recent fires — the run-log tab (1.1). Readable by any board viewer. */
export async function listAutomationRuns(
  actor: string | Principal,
  ruleId: number
): Promise<AutomationRun[]> {
  // requireRule takes a userId; reads accept a principal, so resolve the board
  // and check viewer directly (an agent that can read the board can read the log).
  const row = await queryOne<{ boardId: number }>(
    `SELECT board_id AS "boardId" FROM automation_rule WHERE id = $1`,
    [ruleId]
  );
  if (!row) throw new AuthzError("not_found", "Automation not found");
  await requireBoardRole(actor, row.boardId, "viewer");
  return query<AutomationRun>(
    `SELECT ${RUN_COLUMNS} FROM automation_run WHERE rule_id = $1
      ORDER BY id DESC LIMIT ${RUN_LOG_LIMIT}`,
    [ruleId]
  );
}

// ─────────────────────────── internal (runner-only) ───────────────────────────
// No principal: these run post-commit as the engine, not for a caller. See the
// module comment — the gate is enforced where the actions apply, not here.

export interface DispatchRow {
  id: number;
  boardId: number;
  conditions: AutomationRule["conditions"];
  actions: AutomationRule["actions"];
  createdBy: string;
}

/** Enabled rules on a board subscribed to an event, hitting idx_..._dispatch. */
export async function rulesForDispatch(
  boardId: number,
  event: string
): Promise<DispatchRow[]> {
  return query<DispatchRow>(
    `SELECT id, board_id AS "boardId", conditions, actions,
            created_by AS "createdBy"
       FROM automation_rule
      WHERE board_id = $1 AND is_enabled AND trigger->>'event' = $2
      ORDER BY id`,
    [boardId, event]
  );
}

/**
 * Claims a (rule, activity) pair for this run, the idempotency gate: the UNIQUE
 * constraint means a redelivered event's second INSERT conflicts and returns no
 * row, so the runner knows this rule already fired for this activity and skips.
 * The row is written 'skipped' and promoted to its real status once the rule's
 * outcome is known.
 */
export async function claimRun(
  ruleId: number,
  activityId: string
): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `INSERT INTO automation_run (rule_id, activity_id, status)
     VALUES ($1, $2, 'skipped')
     ON CONFLICT (rule_id, activity_id) DO NOTHING
     RETURNING id`,
    [ruleId, activityId]
  );
  return rows.length > 0;
}

export async function finishRun(
  ruleId: number,
  activityId: string,
  status: AutomationRunStatus,
  detail: unknown
): Promise<void> {
  await query(
    `UPDATE automation_run SET status = $3, detail = $4::jsonb
      WHERE rule_id = $1 AND activity_id = $2`,
    [ruleId, activityId, status, JSON.stringify(detail ?? {})]
  );
}

// ─── scheduled rules (1.4), also runner-only ───

export interface DueRule extends DispatchRow {
  every: string | null;
}

/** Enabled schedule.tick rules whose next_run_at has passed. */
export async function dueScheduledRules(): Promise<DueRule[]> {
  return query<DueRule>(
    `SELECT id, board_id AS "boardId", conditions, actions,
            created_by AS "createdBy", trigger->>'every' AS "every"
       FROM automation_rule
      WHERE is_enabled AND next_run_at IS NOT NULL AND next_run_at <= now()
        AND trigger->>'event' = 'schedule.tick'
      ORDER BY next_run_at`
  );
}

/**
 * Advances a scheduled rule to its next due time. now()-based, not
 * next_run_at-based: a rule that fell behind (the process was down) catches up to
 * the next slot from now rather than replaying every missed tick.
 */
export async function advanceSchedule(
  ruleId: number,
  every: string | null
): Promise<void> {
  const step =
    every === "hourly"
      ? "1 hour"
      : every === "weekly"
        ? "7 days"
        : "1 day"; // daily default
  await query(
    `UPDATE automation_rule SET next_run_at = now() + interval '${step}'
      WHERE id = $1`,
    [ruleId]
  );
}

// ─── inbound trigger tokens (1.12) ───

const TRIGGER_COLUMNS = `id, board_id AS "boardId", name, token,
                         is_active AS "isActive", created_at AS "createdAt"`;

/** A board's inbound trigger tokens. Admin — a token can drive the board. */
export async function listTriggers(
  actor: string | Principal,
  boardId: number
): Promise<AutomationTrigger[]> {
  await requireBoardRole(actor, boardId, "admin");
  return query<AutomationTrigger>(
    `SELECT ${TRIGGER_COLUMNS} FROM automation_trigger WHERE board_id = $1
      ORDER BY id`,
    [boardId]
  );
}

/** Mints a new inbound trigger token for a board (admin). */
export async function createTrigger(
  userId: string,
  boardId: number,
  name: string
): Promise<AutomationTrigger> {
  await requireBoardRole(userId, boardId, "admin");
  const token = randomBytes(24).toString("base64url");
  const rows = await query<AutomationTrigger>(
    `INSERT INTO automation_trigger (board_id, name, token, created_by)
     VALUES ($1, $2, $3, $4)
     RETURNING ${TRIGGER_COLUMNS}`,
    [boardId, name.trim(), token, userId]
  );
  return rows[0];
}

/** Enable/disable or delete a trigger (admin), scoped through its board. */
export async function setTriggerActive(
  userId: string,
  triggerId: number,
  isActive: boolean
): Promise<boolean> {
  const row = await queryOne<{ boardId: number }>(
    `SELECT board_id AS "boardId" FROM automation_trigger WHERE id = $1`,
    [triggerId]
  );
  if (!row) return false;
  await requireBoardRole(userId, row.boardId, "admin");
  await query(`UPDATE automation_trigger SET is_active = $2 WHERE id = $1`, [
    triggerId,
    isActive,
  ]);
  return true;
}

export async function deleteTrigger(
  userId: string,
  triggerId: number
): Promise<boolean> {
  const row = await queryOne<{ boardId: number }>(
    `SELECT board_id AS "boardId" FROM automation_trigger WHERE id = $1`,
    [triggerId]
  );
  if (!row) return false;
  await requireBoardRole(userId, row.boardId, "admin");
  await query(`DELETE FROM automation_trigger WHERE id = $1`, [triggerId]);
  return true;
}

/**
 * Resolves an active trigger token to its board, or null. No principal: the
 * token IS the credential (025's webhook shape), so a match authorizes the fire
 * and a miss/inactive token is simply unauthorized. Board and token are both
 * checked so a token minted for one board cannot fire another.
 */
export async function boardForTriggerToken(
  boardId: number,
  token: string
): Promise<number | null> {
  const row = await queryOne<{ boardId: number }>(
    `SELECT board_id AS "boardId" FROM automation_trigger
      WHERE board_id = $1 AND token = $2 AND is_active`,
    [boardId, token]
  );
  return row?.boardId ?? null;
}

/** Records a scheduled fire — no activity_id (a timer, not an event). */
export async function recordScheduledRun(
  ruleId: number,
  status: AutomationRunStatus,
  detail: unknown
): Promise<void> {
  await query(
    `INSERT INTO automation_run (rule_id, activity_id, status, detail)
     VALUES ($1, NULL, $2, $3::jsonb)`,
    [ruleId, status, JSON.stringify(detail ?? {})]
  );
}
