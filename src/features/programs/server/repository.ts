import type { Principal } from "@/features/auth/server/principal";
import { query, queryOne } from "@/shared/db/client";
import {
  AuthzError,
  requireWorkspaceRole,
} from "@/features/workspaces/server/authz";
import {
  buildProgramsOverview,
  type BoardWithProgram,
} from "../lib/programs";
import type {
  CreateProgramInput,
  Program,
  ProgramsOverview,
  UpdateProgramInput,
} from "../types";

/**
 * Programs / initiatives (040) — the workspace grouping above a board.
 *
 * Reads are viewer+ (the portfolio's rule — a member sees where the workspace
 * stands). Management is admin: creating an initiative, renaming it, deleting it,
 * and filing a board under it are structural decisions about the workspace, the
 * rank column-deletion asks for at the board level (§7.4's blast-radius rule).
 * Deletion is safe at admin because program_id is SET NULL — it un-groups the
 * boards, it never removes a project.
 *
 * No activity log: activity_log is board-scoped (it carries a boardId), and a
 * program is a workspace-level grouping with no board to log against — the
 * portfolio's read-only precedent. The board's own program_id change is a config
 * fact visible in the overview, not a task event.
 */

const PROGRAM_COLUMNS = `id, workspace_id AS "workspaceId", name,
                         created_at AS "createdAt"`;

export async function getWorkspacePrograms(
  actor: string | Principal,
  workspaceId: string
): Promise<ProgramsOverview> {
  await requireWorkspaceRole(actor, workspaceId, "viewer");

  const programs = await query<Program>(
    `SELECT ${PROGRAM_COLUMNS} FROM program WHERE workspace_id = $1`,
    [workspaceId]
  );

  // The portfolio board rollup (040 reuses it), plus each board's program_id so
  // the rows can be grouped. Correlated subqueries per board, top-level tasks,
  // "done" keyed on each board's designated done column — portfolio.ts's query
  // with one extra column.
  const boards = await query<BoardWithProgram>(
    `SELECT b.id, b.name, b.program_id AS "programId",
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
      WHERE b.workspace_id = $1
      ORDER BY b.position, b.id`,
    [workspaceId]
  );

  return buildProgramsOverview(programs, boards);
}

export async function createProgram(
  userId: string,
  workspaceId: string,
  input: CreateProgramInput
): Promise<Program> {
  await requireWorkspaceRole(userId, workspaceId, "admin");
  const row = await queryOne<Program>(
    `INSERT INTO program (workspace_id, name) VALUES ($1, $2)
     RETURNING ${PROGRAM_COLUMNS}`,
    [workspaceId, input.name.trim()]
  );
  return row!;
}

/** Resolves a program's workspace and proves the caller is an admin there. */
async function requireProgram(
  userId: string,
  id: number
): Promise<{ workspaceId: string }> {
  const row = await queryOne<{ workspaceId: string }>(
    `SELECT workspace_id AS "workspaceId" FROM program WHERE id = $1`,
    [id]
  );
  if (!row) throw new AuthzError("not_found", "Program not found");
  await requireWorkspaceRole(userId, row.workspaceId, "admin");
  return { workspaceId: row.workspaceId };
}

export async function updateProgram(
  userId: string,
  id: number,
  input: UpdateProgramInput
): Promise<Program | undefined> {
  await requireProgram(userId, id);
  const row = await queryOne<Program>(
    `UPDATE program SET name = COALESCE($2, name) WHERE id = $1
     RETURNING ${PROGRAM_COLUMNS}`,
    [id, input.name?.trim() ?? null]
  );
  return row ?? undefined;
}

export async function deleteProgram(userId: string, id: number): Promise<boolean> {
  await requireProgram(userId, id);
  await query(`DELETE FROM program WHERE id = $1`, [id]);
  return true;
}

/**
 * Files a board under a program, or clears it (programId null). Admin — grouping
 * a project into an initiative is a workspace-structure decision. The program
 * must belong to the *same workspace* as the board (assertObjectiveOnBoard's
 * cross-tenant guard, one level up): not_found otherwise, so a bare FK cannot be
 * used to file a board under another workspace's initiative.
 */
export async function setBoardProgram(
  userId: string,
  boardId: number,
  programId: number | null
): Promise<void> {
  const board = await queryOne<{ workspaceId: string }>(
    `SELECT workspace_id AS "workspaceId" FROM board WHERE id = $1`,
    [boardId]
  );
  if (!board) throw new AuthzError("not_found", "Board not found");
  await requireWorkspaceRole(userId, board.workspaceId, "admin");

  if (programId !== null) {
    const program = await queryOne(
      `SELECT 1 FROM program WHERE id = $1 AND workspace_id = $2`,
      [programId, board.workspaceId]
    );
    if (!program) {
      throw new AuthzError("not_found", "That program is not in this workspace");
    }
  }

  await query(`UPDATE board SET program_id = $2 WHERE id = $1`, [
    boardId,
    programId,
  ]);
}
