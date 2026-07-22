import type { Principal } from "@/features/auth/server/principal";
import { query, queryOne } from "@/shared/db/client";
import {
  AuthzError,
  requireWorkspaceRole,
} from "@/features/workspaces/server/authz";
import { buildScaledAgile } from "../lib/scaledAgile";
import type {
  CreateTeamInput,
  ScaledAgileOverview,
  SafBoard,
  Team,
  TeamMemberRef,
  TeamWithMembers,
  UpdateTeamInput,
} from "../types";

/**
 * Teams + Scaled Agile / SAFe (044) — the workspace's team layer and the composed
 * layer-cake view.
 *
 * Reads are viewer+ (the portfolio's rule — a member sees how the workspace is
 * organised). Management is admin: creating a team, renaming it, deleting it,
 * changing its roster, and naming a board's owning team are all workspace-
 * structure decisions — programs' rank (§7.4's blast-radius rule). Deletion is
 * safe at admin because team_id is SET NULL: it un-owns the boards, it never
 * removes a project.
 *
 * No activity log: teams are a workspace-level grouping with no board to log
 * against (programs' / portfolio's read-only precedent).
 */

const TEAM_COLUMNS = `id, workspace_id AS "workspaceId", name,
                      created_at AS "createdAt"`;

export async function getScaledAgileOverview(
  actor: string | Principal,
  workspaceId: string
): Promise<ScaledAgileOverview> {
  await requireWorkspaceRole(actor, workspaceId, "viewer");

  const teams = await query<Team>(
    `SELECT ${TEAM_COLUMNS} FROM team WHERE workspace_id = $1 ORDER BY name, id`,
    [workspaceId]
  );

  // Every team's roster in one read; grouped onto its team below.
  const roster = await query<{ teamId: number; userId: string; name: string }>(
    `SELECT tm.team_id AS "teamId", tm.user_id AS "userId", u.name
       FROM team_member tm
       JOIN "user" u ON u.id = tm.user_id
      WHERE tm.team_id IN (SELECT id FROM team WHERE workspace_id = $1)
      ORDER BY u.name, tm.user_id`,
    [workspaceId]
  );
  const membersByTeam = new Map<number, TeamMemberRef[]>();
  for (const r of roster) {
    const list = membersByTeam.get(r.teamId) ?? [];
    list.push({ userId: r.userId, name: r.name });
    membersByTeam.set(r.teamId, list);
  }
  const teamsWithMembers: TeamWithMembers[] = teams.map((t) => ({
    ...t,
    members: membersByTeam.get(t.id) ?? [],
  }));

  // The workspace roster, for the add-to-team and its "who's already on a team"
  // pickers.
  const members = await query<TeamMemberRef>(
    `SELECT wm.user_id AS "userId", u.name
       FROM workspace_member wm
       JOIN "user" u ON u.id = wm.user_id
      WHERE wm.workspace_id = $1
      ORDER BY u.name, wm.user_id`,
    [workspaceId]
  );

  const arts = await query<{ id: number; name: string }>(
    `SELECT id, name FROM program WHERE workspace_id = $1`,
    [workspaceId]
  );

  // The portfolio rollup per board (the programs read), plus each board's ART
  // (program_id) and owning team (LEFT JOIN team). Correlated subqueries, top-
  // level tasks, "done" keyed on each board's designated done column.
  const boards = await query<SafBoard>(
    `SELECT b.id, b.name, b.program_id AS "programId",
            b.team_id AS "teamId", tm.name AS "teamName",
            (SELECT COUNT(*)::int
               FROM task t
               JOIN board_column bc ON bc.id = t.column_id
              WHERE bc.board_id = b.id AND t.parent_id IS NULL) AS total,
            (SELECT COUNT(*)::int
               FROM task t
              WHERE t.parent_id IS NULL
                AND b.done_column_id IS NOT NULL
                AND t.column_id = b.done_column_id) AS done,
            (b.done_column_id IS NOT NULL) AS "hasDoneColumn",
            (SELECT COUNT(*)::int
               FROM milestone m WHERE m.board_id = b.id) AS milestones,
            (SELECT COUNT(*)::int
               FROM task t
               JOIN board_column bc ON bc.id = t.column_id
              WHERE bc.board_id = b.id AND t.parent_id IS NULL
                AND t.due_date IS NOT NULL AND t.due_date < CURRENT_DATE
                AND (b.done_column_id IS NULL
                     OR t.column_id <> b.done_column_id)) AS overdue
       FROM board b
       LEFT JOIN team tm ON tm.id = b.team_id
      WHERE b.workspace_id = $1
      ORDER BY b.position, b.id`,
    [workspaceId]
  );

  return buildScaledAgile(arts, boards, teamsWithMembers, members);
}

export async function createTeam(
  userId: string,
  workspaceId: string,
  input: CreateTeamInput
): Promise<Team> {
  await requireWorkspaceRole(userId, workspaceId, "admin");
  const row = await queryOne<Team>(
    `INSERT INTO team (workspace_id, name) VALUES ($1, $2)
     RETURNING ${TEAM_COLUMNS}`,
    [workspaceId, input.name.trim()]
  );
  return row!;
}

/** Resolves a team's workspace and proves the caller is an admin there. */
async function requireTeam(
  userId: string,
  id: number
): Promise<{ workspaceId: string }> {
  const row = await queryOne<{ workspaceId: string }>(
    `SELECT workspace_id AS "workspaceId" FROM team WHERE id = $1`,
    [id]
  );
  if (!row) throw new AuthzError("not_found", "Team not found");
  await requireWorkspaceRole(userId, row.workspaceId, "admin");
  return row;
}

export async function updateTeam(
  userId: string,
  id: number,
  input: UpdateTeamInput
): Promise<Team | undefined> {
  await requireTeam(userId, id);
  const row = await queryOne<Team>(
    `UPDATE team SET name = COALESCE($2, name) WHERE id = $1
     RETURNING ${TEAM_COLUMNS}`,
    [id, input.name?.trim() ?? null]
  );
  return row ?? undefined;
}

export async function deleteTeam(userId: string, id: number): Promise<boolean> {
  await requireTeam(userId, id);
  await query(`DELETE FROM team WHERE id = $1`, [id]);
  return true;
}

/**
 * Adds a person to a team (admin). The target must be a member of the team's
 * *own workspace* — not_found otherwise (capacity's guard), so the endpoint
 * cannot pull a stranger onto a team by a bare user id. Idempotent: adding
 * someone already on the team is a no-op (ON CONFLICT DO NOTHING).
 */
export async function addTeamMember(
  userId: string,
  teamId: number,
  targetUserId: string
): Promise<void> {
  const { workspaceId } = await requireTeam(userId, teamId);
  const member = await queryOne(
    `SELECT 1 FROM workspace_member WHERE workspace_id = $1 AND user_id = $2`,
    [workspaceId, targetUserId]
  );
  if (!member) {
    throw new AuthzError("not_found", "That user is not in this workspace");
  }
  await query(
    `INSERT INTO team_member (team_id, user_id) VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [teamId, targetUserId]
  );
}

export async function removeTeamMember(
  userId: string,
  teamId: number,
  targetUserId: string
): Promise<void> {
  await requireTeam(userId, teamId);
  await query(`DELETE FROM team_member WHERE team_id = $1 AND user_id = $2`, [
    teamId,
    targetUserId,
  ]);
}

/**
 * Names the team that owns a board, or clears it (teamId null). Admin — team
 * ownership is a workspace-structure decision. The team must belong to the
 * *same workspace* as the board (setBoardProgram's cross-tenant guard, 040):
 * not_found otherwise, so a bare FK cannot hand a board to another workspace's
 * team.
 */
export async function setBoardTeam(
  userId: string,
  boardId: number,
  teamId: number | null
): Promise<void> {
  const board = await queryOne<{ workspaceId: string }>(
    `SELECT workspace_id AS "workspaceId" FROM board WHERE id = $1`,
    [boardId]
  );
  if (!board) throw new AuthzError("not_found", "Board not found");
  await requireWorkspaceRole(userId, board.workspaceId, "admin");

  if (teamId !== null) {
    const team = await queryOne(
      `SELECT 1 FROM team WHERE id = $1 AND workspace_id = $2`,
      [teamId, board.workspaceId]
    );
    if (!team) {
      throw new AuthzError("not_found", "That team is not in this workspace");
    }
  }

  await query(`UPDATE board SET team_id = $2 WHERE id = $1`, [boardId, teamId]);
}
