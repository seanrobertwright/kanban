import { queryOne } from "@/shared/db/client";
import { asPrincipal } from "@/features/auth/server/principal";
import type { Principal } from "@/features/auth/server/principal";
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

/**
 * The one place a human and an agent diverge in every resource check: where a
 * human's role is found. Both are aliased `wm` so the surrounding SELECT — always
 * `wm.role` — is identical, and both join on `b.workspace_id`, so the resource
 * queries below need only splice this clause in and bind the principal's id.
 *
 * A human's role is an edge in workspace_member; an agent's is an attribute on
 * its own row (009), scoped to the one workspace it belongs to. Joining `agent`
 * on `workspace_id` is what makes a resource in another workspace resolve to no
 * row — reported as not_found, the same anti-enumeration answer a human gets, so
 * an agent's token cannot be used to probe which ids exist elsewhere.
 */
function membershipJoin(principal: Principal): { join: string; id: string } {
  return principal.kind === "human"
    ? {
        join: `JOIN workspace_member wm
                 ON wm.workspace_id = b.workspace_id AND wm.user_id = $2`,
        id: principal.userId,
      }
    : {
        join: `JOIN agent wm
                 ON wm.workspace_id = b.workspace_id AND wm.id = $2`,
        id: principal.agentId,
      };
}

export async function requireWorkspaceRole(
  principal: string | Principal,
  workspaceId: string,
  min: WorkspaceRole
): Promise<WorkspaceRole> {
  const p = asPrincipal(principal);
  // No board to join through here, so this one does not use membershipJoin: it
  // reads the role straight from the principal's own table, keyed on the
  // workspace it is being asked about.
  const row = await queryOne<{ role: WorkspaceRole }>(
    p.kind === "human"
      ? `SELECT role FROM workspace_member WHERE workspace_id = $1 AND user_id = $2`
      : `SELECT role FROM agent WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, p.kind === "human" ? p.userId : p.agentId]
  );
  if (!row) throw new AuthzError("not_found", "Workspace not found");
  return assertRank(row.role, min, "act in this workspace");
}

export async function requireBoardRole(
  principal: string | Principal,
  boardId: number,
  min: WorkspaceRole
): Promise<{ role: WorkspaceRole; workspaceId: string }> {
  const { join, id } = membershipJoin(asPrincipal(principal));
  const row = await queryOne<{ role: WorkspaceRole; workspaceId: string }>(
    `SELECT wm.role, b.workspace_id AS "workspaceId"
       FROM board b
       ${join}
      WHERE b.id = $1`,
    [boardId, id]
  );
  if (!row) throw new AuthzError("not_found", "Board not found");
  assertRank(row.role, min, "act on this board");
  return row;
}

/**
 * These two also return `workspaceId`, which the joins already walk through on
 * their way to workspace_member. The activity log needs it on every write and
 * cannot re-derive it later — by then the task may be deleted, leaving nothing
 * to join through (see 003_activity_log.sql). Returning it from the check that
 * already proved it is cheaper and less forgettable than a second lookup.
 */
export interface ColumnAccess {
  role: WorkspaceRole;
  boardId: number;
  workspaceId: string;
}

export async function requireColumnRole(
  principal: string | Principal,
  columnId: number,
  min: WorkspaceRole
): Promise<ColumnAccess> {
  const { join, id } = membershipJoin(asPrincipal(principal));
  const row = await queryOne<ColumnAccess>(
    `SELECT wm.role, bc.board_id AS "boardId", b.workspace_id AS "workspaceId"
       FROM board_column bc
       JOIN board b ON b.id = bc.board_id
       ${join}
      WHERE bc.id = $1`,
    [columnId, id]
  );
  if (!row) throw new AuthzError("not_found", "Column not found");
  assertRank(row.role, min, "act on this column");
  return row;
}

export async function requireTaskRole(
  principal: string | Principal,
  taskId: number,
  min: WorkspaceRole
): Promise<ColumnAccess> {
  const { join, id } = membershipJoin(asPrincipal(principal));
  const row = await queryOne<ColumnAccess>(
    `SELECT wm.role, bc.board_id AS "boardId", b.workspace_id AS "workspaceId"
       FROM task t
       JOIN board_column bc ON bc.id = t.column_id
       JOIN board b ON b.id = bc.board_id
       ${join}
      WHERE t.id = $1`,
    [taskId, id]
  );
  if (!row) throw new AuthzError("not_found", "Task not found");
  assertRank(row.role, min, "modify this task");
  return row;
}
