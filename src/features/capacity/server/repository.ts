import type { Principal } from "@/features/auth/server/principal";
import { query, queryOne } from "@/shared/db/client";
import {
  AuthzError,
  requireBoardRole,
  requireWorkspaceRole,
} from "@/features/workspaces/server/authz";
import { summarizeCapacity, utilization } from "../lib/capacity";
import type {
  CapacityPlan,
  CapacityRow,
  MemberCapacity,
  SetMemberCapacityInput,
} from "../types";

/**
 * Resource & capacity planning (041).
 *
 * The plan is viewer+ (a read of what the board already holds, the analytics /
 * timesheet rule). Setting a member's role and budget is admin — a person's
 * capacity is a workspace-structure fact, the rank member-role changes ask for.
 *
 * Demand is measured in story points (task.estimate, 022) so it compares to the
 * point budget directly; "open" work is everything not in the board's done column
 * (020's completion notion), because finished work is no longer a claim on
 * anyone's capacity. Agents are out of this view by design — an agent's spend is
 * metered in dollars, not a point budget (the log_time cut's reasoning) — so a
 * human-only roster is the honest capacity picture.
 *
 * No activity log: a capacity number is planning config, not a task event
 * (custom-field-def / portfolio precedent).
 */

interface DemandRow {
  userId: string;
  points: number;
  tasks: number;
}

export async function getBoardCapacity(
  actor: string | Principal,
  boardId: number
): Promise<CapacityPlan> {
  await requireBoardRole(actor, boardId, "viewer");

  const board = await queryOne<{ workspaceId: string; doneColumnId: number | null }>(
    `SELECT workspace_id AS "workspaceId", done_column_id AS "doneColumnId"
       FROM board WHERE id = $1`,
    [boardId]
  );
  if (!board) throw new AuthzError("not_found", "Board not found");

  // Every human member with their role + budget (LEFT JOIN — a member with no
  // capacity row reads 0 / "", "no budget set").
  const members = await query<{
    userId: string;
    name: string;
    weeklyPoints: number;
    role: string;
  }>(
    `SELECT wm.user_id AS "userId", u.name,
            COALESCE(mc.weekly_points, 0) AS "weeklyPoints",
            COALESCE(mc.role, '') AS role
       FROM workspace_member wm
       JOIN "user" u ON u.id = wm.user_id
       LEFT JOIN member_capacity mc
         ON mc.workspace_id = wm.workspace_id AND mc.user_id = wm.user_id
      WHERE wm.workspace_id = $1
      ORDER BY u.name, wm.user_id`,
    [board.workspaceId]
  );

  // Open assigned demand, grouped by member. The done-column guard ($2) drops
  // finished work — a null done column means nothing is "done", so all of it
  // counts (the honest-zero rule the board read uses everywhere).
  const demand = await query<DemandRow>(
    `SELECT t.assignee_id AS "userId",
            COALESCE(SUM(t.estimate), 0)::int AS points,
            COUNT(*)::int AS tasks
       FROM task t
       JOIN board_column bc ON bc.id = t.column_id
      WHERE bc.board_id = $1 AND t.parent_id IS NULL
        AND t.assignee_id IS NOT NULL
        AND ($2::int IS NULL OR t.column_id <> $2)
      GROUP BY t.assignee_id`,
    [boardId, board.doneColumnId]
  );
  const demandByUser = new Map(demand.map((d) => [d.userId, d]));

  const unassigned = await queryOne<{ points: number; tasks: number }>(
    `SELECT COALESCE(SUM(t.estimate), 0)::int AS points, COUNT(*)::int AS tasks
       FROM task t
       JOIN board_column bc ON bc.id = t.column_id
      WHERE bc.board_id = $1 AND t.parent_id IS NULL
        AND t.assignee_id IS NULL AND t.agent_id IS NULL
        AND ($2::int IS NULL OR t.column_id <> $2)`,
    [boardId, board.doneColumnId]
  );

  const rows: CapacityRow[] = members.map((m) => {
    const d = demandByUser.get(m.userId);
    const committedPoints = d?.points ?? 0;
    return {
      userId: m.userId,
      name: m.name,
      role: m.role,
      weeklyPoints: m.weeklyPoints,
      committedPoints,
      openTasks: d?.tasks ?? 0,
      utilization: utilization(committedPoints, m.weeklyPoints),
    };
  });

  return {
    rows,
    unassigned: unassigned ?? { points: 0, tasks: 0 },
    totals: summarizeCapacity(rows),
  };
}

/**
 * Sets a member's role and weekly budget (admin), upserting the one row. The
 * target must be a member of the workspace — not_found otherwise, so the endpoint
 * cannot be used to write a capacity row for a stranger.
 */
export async function setMemberCapacity(
  actorUserId: string,
  workspaceId: string,
  targetUserId: string,
  input: SetMemberCapacityInput
): Promise<MemberCapacity> {
  await requireWorkspaceRole(actorUserId, workspaceId, "admin");

  const member = await queryOne(
    `SELECT 1 FROM workspace_member WHERE workspace_id = $1 AND user_id = $2`,
    [workspaceId, targetUserId]
  );
  if (!member) throw new AuthzError("not_found", "That member is not in this workspace");

  const row = await queryOne<MemberCapacity>(
    `INSERT INTO member_capacity (workspace_id, user_id, weekly_points, role)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (workspace_id, user_id)
       DO UPDATE SET weekly_points = EXCLUDED.weekly_points, role = EXCLUDED.role
     RETURNING user_id AS "userId", weekly_points AS "weeklyPoints", role`,
    [workspaceId, targetUserId, input.weeklyPoints, input.role.trim()]
  );
  return row!;
}
