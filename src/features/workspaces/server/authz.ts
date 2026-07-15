import { queryOne } from "@/shared/db/client";
import type { WorkspaceRole } from "../types";

export const ROLE_RANK: Record<WorkspaceRole, number> = {
  viewer: 0,
  member: 1,
  admin: 2,
  owner: 3,
};

export class AuthzError extends Error {
  constructor(
    /**
     * "conflict" is not a permission failure — it marks an action the caller is
     * allowed to attempt but that would break an invariant (removing the last
     * owner). It rides on this class only so route handlers keep one catch.
     */
    readonly kind: "not_found" | "forbidden" | "conflict",
    message: string
  ) {
    super(message);
    this.name = "AuthzError";
  }
}

const STATUS_BY_KIND = {
  not_found: 404,
  forbidden: 403,
  conflict: 409,
} as const;

/**
 * Every check below resolves the resource and the caller's membership in a
 * SINGLE join, and reports a missing row as "not_found" — never "forbidden".
 *
 * That collapses "this board does not exist" and "this board exists in someone
 * else's workspace" into the same answer. Splitting them would turn the id
 * space into an oracle: a stranger could enumerate ids and learn which ones are
 * real from the 403-vs-404 difference. "Forbidden" is reserved for callers who
 * ARE members and merely lack the rank (a viewer trying to write) — that leaks
 * nothing they cannot already see.
 */
function assertRank(role: WorkspaceRole, min: WorkspaceRole, what: string) {
  if (ROLE_RANK[role] < ROLE_RANK[min]) {
    throw new AuthzError(
      "forbidden",
      `Your role (${role}) cannot ${what}; requires ${min} or higher.`
    );
  }
  return role;
}

/**
 * Maps an AuthzError to its HTTP response. Rethrows anything else, so a genuine
 * bug surfaces as a 500 instead of being disguised as a permission failure.
 */
export function authzErrorResponse(error: unknown): Response {
  if (error instanceof AuthzError) {
    return Response.json(
      { error: error.message },
      { status: STATUS_BY_KIND[error.kind] }
    );
  }
  throw error;
}

export async function requireWorkspaceRole(
  userId: string,
  workspaceId: string,
  min: WorkspaceRole
): Promise<WorkspaceRole> {
  const row = await queryOne<{ role: WorkspaceRole }>(
    `SELECT role FROM workspace_member WHERE workspace_id = $1 AND user_id = $2`,
    [workspaceId, userId]
  );
  if (!row) throw new AuthzError("not_found", "Workspace not found");
  return assertRank(row.role, min, "act in this workspace");
}

export async function requireBoardRole(
  userId: string,
  boardId: number,
  min: WorkspaceRole
): Promise<{ role: WorkspaceRole; workspaceId: string }> {
  const row = await queryOne<{ role: WorkspaceRole; workspaceId: string }>(
    `SELECT wm.role, b.workspace_id AS "workspaceId"
       FROM board b
       JOIN workspace_member wm
         ON wm.workspace_id = b.workspace_id AND wm.user_id = $2
      WHERE b.id = $1`,
    [boardId, userId]
  );
  if (!row) throw new AuthzError("not_found", "Board not found");
  assertRank(row.role, min, "act on this board");
  return row;
}

export async function requireColumnRole(
  userId: string,
  columnId: number,
  min: WorkspaceRole
): Promise<{ role: WorkspaceRole; boardId: number }> {
  const row = await queryOne<{ role: WorkspaceRole; boardId: number }>(
    `SELECT wm.role, bc.board_id AS "boardId"
       FROM board_column bc
       JOIN board b ON b.id = bc.board_id
       JOIN workspace_member wm
         ON wm.workspace_id = b.workspace_id AND wm.user_id = $2
      WHERE bc.id = $1`,
    [columnId, userId]
  );
  if (!row) throw new AuthzError("not_found", "Column not found");
  assertRank(row.role, min, "act on this column");
  return row;
}

export async function requireTaskRole(
  userId: string,
  taskId: number,
  min: WorkspaceRole
): Promise<{ role: WorkspaceRole; boardId: number }> {
  const row = await queryOne<{ role: WorkspaceRole; boardId: number }>(
    `SELECT wm.role, bc.board_id AS "boardId"
       FROM task t
       JOIN board_column bc ON bc.id = t.column_id
       JOIN board b ON b.id = bc.board_id
       JOIN workspace_member wm
         ON wm.workspace_id = b.workspace_id AND wm.user_id = $2
      WHERE t.id = $1`,
    [taskId, userId]
  );
  if (!row) throw new AuthzError("not_found", "Task not found");
  assertRank(row.role, min, "modify this task");
  return row;
}
