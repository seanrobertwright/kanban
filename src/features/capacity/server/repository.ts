import type { Principal } from "@/features/auth/server/principal";
import { query, queryOne } from "@/shared/db/client";
import {
  AuthzError,
  requireBoardRole,
  requireWorkspaceRole,
} from "@/features/workspaces/server/authz";
import {
  availablePoints,
  summarizeCapacity,
  utilization,
  weekWindow,
  workdaysOff,
} from "../lib/capacity";
import type {
  CapacityPlan,
  CapacityRow,
  CreateTimeOffInput,
  MemberCapacity,
  SetMemberCapacityInput,
  TimeOff,
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
 * Time off (090) prorates the budget rather than the demand: leave changes how
 * much of the week a person has, never which tasks are theirs. The window is the
 * Monday–Sunday week containing today, because the budget it adjusts is a weekly
 * one — a plan that prorated against "all future leave" would report a capacity
 * nobody's current week has.
 *
 * No activity log: a capacity number is planning config, not a task event
 * (custom-field-def / portfolio precedent). Time off follows it — an absence is
 * config about a person, and the board's feed is about the board's work.
 */

interface DemandRow {
  userId: string;
  points: number;
  tasks: number;
}

/** Today, server-side, as an ISO date. A parameter on the read below so tests
 *  can pin a week instead of passing whenever they happen to run. */
function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function getBoardCapacity(
  actor: string | Principal,
  boardId: number,
  todayIso: string = isoToday()
): Promise<CapacityPlan> {
  await requireBoardRole(actor, boardId, "viewer");
  const week = weekWindow(todayIso);

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

  // Absences from this week onward (090). Entries that ended before the window
  // are history: they can no longer change a budget, and the dialog offers to
  // revoke only leave that is still ahead of the plan.
  const away = await query<TimeOff>(
    `SELECT id, user_id AS "userId", note,
            to_char(starts_on, 'YYYY-MM-DD') AS "startsOn",
            to_char(ends_on, 'YYYY-MM-DD') AS "endsOn"
       FROM member_time_off
      WHERE workspace_id = $1 AND ends_on >= $2::date
      ORDER BY starts_on, id`,
    [board.workspaceId, week.start]
  );
  const awayByUser = new Map<string, TimeOff[]>();
  for (const entry of away) {
    const list = awayByUser.get(entry.userId);
    if (list) list.push(entry);
    else awayByUser.set(entry.userId, [entry]);
  }

  const rows: CapacityRow[] = members.map((m) => {
    const d = demandByUser.get(m.userId);
    const committedPoints = d?.points ?? 0;
    const timeOff = awayByUser.get(m.userId) ?? [];
    const daysOff = workdaysOff(timeOff, week.start, week.end);
    const available = availablePoints(m.weeklyPoints, daysOff);
    return {
      userId: m.userId,
      name: m.name,
      role: m.role,
      weeklyPoints: m.weeklyPoints,
      daysOff,
      availablePoints: available,
      committedPoints,
      openTasks: d?.tasks ?? 0,
      utilization: utilization(committedPoints, available),
      timeOff,
    };
  });

  return {
    rows,
    unassigned: unassigned ?? { points: 0, tasks: 0 },
    totals: summarizeCapacity(rows),
    week,
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

  const capacityRow = await queryOne<MemberCapacity>(
    `INSERT INTO member_capacity (workspace_id, user_id, weekly_points, role)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (workspace_id, user_id)
       DO UPDATE SET weekly_points = EXCLUDED.weekly_points, role = EXCLUDED.role
     RETURNING user_id AS "userId", weekly_points AS "weeklyPoints", role`,
    [workspaceId, targetUserId, input.weeklyPoints, input.role.trim()]
  );
  return capacityRow!;
}

/**
 * Books an absence (090). Self-or-admin, unlike setting a budget: a budget is a
 * workspace-structure fact only an admin should decide, but your own leave is
 * yours to record — the own-or-admin rule time entries already use. Booking
 * *someone else's* leave stays admin.
 *
 * Same member guard as the budget write, so the endpoint cannot park a row
 * against a stranger's id.
 */
export async function createTimeOff(
  actorUserId: string,
  workspaceId: string,
  input: CreateTimeOffInput
): Promise<TimeOff> {
  await requireWorkspaceRole(
    actorUserId,
    workspaceId,
    input.userId === actorUserId ? "member" : "admin"
  );

  const member = await queryOne(
    `SELECT 1 FROM workspace_member WHERE workspace_id = $1 AND user_id = $2`,
    [workspaceId, input.userId]
  );
  if (!member)
    throw new AuthzError("not_found", "That member is not in this workspace");

  const row = await queryOne<TimeOff>(
    `INSERT INTO member_time_off (workspace_id, user_id, starts_on, ends_on, note)
     VALUES ($1, $2, $3::date, $4::date, $5)
     RETURNING id, user_id AS "userId", note,
               to_char(starts_on, 'YYYY-MM-DD') AS "startsOn",
               to_char(ends_on, 'YYYY-MM-DD') AS "endsOn"`,
    [workspaceId, input.userId, input.startsOn, input.endsOn, (input.note ?? "").trim()]
  );
  return row!;
}

/**
 * Revokes an absence. Own-or-admin, decided from the row itself: the DELETE is
 * scoped by workspace and (for a non-admin) by user_id, so a member cannot cancel
 * a colleague's leave and a miss reads as not_found rather than telling a caller
 * that someone else's entry id exists.
 */
export async function deleteTimeOff(
  actorUserId: string,
  workspaceId: string,
  entryId: number
): Promise<void> {
  const role = await requireWorkspaceRole(actorUserId, workspaceId, "member");
  const isAdmin = role === "admin" || role === "owner";

  const deleted = await queryOne(
    `DELETE FROM member_time_off
      WHERE id = $1 AND workspace_id = $2
        AND ($3::boolean OR user_id = $4)
      RETURNING id`,
    [entryId, workspaceId, isAdmin, actorUserId]
  );
  if (!deleted) throw new AuthzError("not_found", "Time off not found");
}
