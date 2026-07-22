import type { Principal } from "@/features/auth/server/principal";
import { query, queryOne } from "@/shared/db/client";
import {
  AuthzError,
  requireBoardRole,
  requireTaskRole,
} from "@/features/workspaces/server/authz";
import { slaRemainingMins } from "../types";
import type {
  CreateSlaPolicyInput,
  SlaPolicy,
  TaskSlaStatus,
  UpdateSlaPolicyInput,
} from "../types";

/**
 * SLA policies + timers (050, rock 1.6). Policies are board config that acts on
 * everyone's tasks, so authoring is admin (§7.4); reads are viewer+. Timers are
 * started and breached by the sweep (sweep.ts), not here — those functions take
 * no principal, the runner/scheduler discipline.
 */

const POLICY_COLUMNS = `id, board_id AS "boardId", name, applies_when AS "appliesWhen",
                        target_mins AS "targetMins", action_on_breach AS "actionOnBreach",
                        is_enabled AS "isEnabled", created_at AS "createdAt"`;

export async function listSlaPolicies(
  actor: string | Principal,
  boardId: number
): Promise<SlaPolicy[]> {
  await requireBoardRole(actor, boardId, "viewer");
  return query<SlaPolicy>(
    `SELECT ${POLICY_COLUMNS} FROM sla_policy WHERE board_id = $1 ORDER BY name, id`,
    [boardId]
  );
}

export async function createSlaPolicy(
  userId: string,
  boardId: number,
  input: CreateSlaPolicyInput
): Promise<SlaPolicy> {
  await requireBoardRole(userId, boardId, "admin");
  const rows = await query<SlaPolicy>(
    `INSERT INTO sla_policy
       (board_id, name, applies_when, target_mins, action_on_breach, is_enabled, created_by)
     VALUES ($1, $2, $3::jsonb, $4, $5::jsonb, $6, $7)
     RETURNING ${POLICY_COLUMNS}`,
    [
      boardId,
      input.name.trim(),
      JSON.stringify(input.appliesWhen ?? {}),
      input.targetMins,
      JSON.stringify(input.actionOnBreach ?? []),
      input.isEnabled ?? true,
      userId,
    ]
  );
  return rows[0];
}

async function requirePolicy(userId: string, id: number): Promise<number> {
  const row = await queryOne<{ boardId: number }>(
    `SELECT board_id AS "boardId" FROM sla_policy WHERE id = $1`,
    [id]
  );
  if (!row) throw new AuthzError("not_found", "SLA policy not found");
  await requireBoardRole(userId, row.boardId, "admin");
  return row.boardId;
}

export async function updateSlaPolicy(
  userId: string,
  id: number,
  input: UpdateSlaPolicyInput
): Promise<SlaPolicy | undefined> {
  await requirePolicy(userId, id);
  const setsApplies = input.appliesWhen !== undefined;
  const setsActions = input.actionOnBreach !== undefined;
  const rows = await query<SlaPolicy>(
    `UPDATE sla_policy
        SET name = COALESCE($2, name),
            applies_when = CASE WHEN $3::boolean THEN $4::jsonb ELSE applies_when END,
            target_mins = COALESCE($5, target_mins),
            action_on_breach = CASE WHEN $6::boolean THEN $7::jsonb ELSE action_on_breach END,
            is_enabled = COALESCE($8, is_enabled)
      WHERE id = $1
      RETURNING ${POLICY_COLUMNS}`,
    [
      id,
      input.name?.trim() ?? null,
      setsApplies,
      setsApplies ? JSON.stringify(input.appliesWhen) : null,
      input.targetMins ?? null,
      setsActions,
      setsActions ? JSON.stringify(input.actionOnBreach) : null,
      input.isEnabled ?? null,
    ]
  );
  return rows[0];
}

export async function deleteSlaPolicy(userId: string, id: number): Promise<boolean> {
  await requirePolicy(userId, id);
  await query(`DELETE FROM sla_policy WHERE id = $1`, [id]);
  return true;
}

/**
 * A task's live SLA timers with derived remaining/breached, for the task dialog.
 * now() is read once in SQL and passed to the pure helper so the derived fields
 * agree with the breach sweep's clock.
 */
export async function taskSlaStatus(
  actor: string | Principal,
  taskId: number
): Promise<TaskSlaStatus[]> {
  await requireTaskRole(actor, taskId, "viewer");
  const rows = await query<{
    policyId: number;
    policyName: string;
    startedAt: string;
    dueAt: string;
    breachedAt: string | null;
    nowMs: string;
  }>(
    `SELECT ts.policy_id AS "policyId", p.name AS "policyName",
            ts.started_at AS "startedAt", ts.due_at AS "dueAt",
            ts.breached_at AS "breachedAt",
            (extract(epoch from now()) * 1000)::bigint AS "nowMs"
       FROM task_sla ts JOIN sla_policy p ON p.id = ts.policy_id
      WHERE ts.task_id = $1
      ORDER BY ts.due_at`,
    [taskId]
  );
  return rows.map((r) => {
    const nowMs = Number(r.nowMs);
    const dueMs = Date.parse(r.dueAt);
    return {
      policyId: r.policyId,
      policyName: r.policyName,
      startedAt: r.startedAt,
      dueAt: r.dueAt,
      breachedAt: r.breachedAt,
      remainingMins: slaRemainingMins(dueMs, nowMs),
      breached: r.breachedAt !== null || nowMs >= dueMs,
    };
  });
}
