import type { Principal } from "@/features/auth/server/principal";
import { query } from "@/shared/db/client";
import type { Portfolio, PortfolioBoard } from "../types";
import { requireWorkspaceRole } from "./authz";
import { summarizePortfolio } from "../lib/portfolio";

/**
 * The portfolio (040): every board in a workspace rolled up into one glance —
 * task counts, completion, milestones and overdue work — so an owner does not
 * have to switch into each board to see where it stands.
 *
 * Viewer+, workspace-scoped: membership is at the workspace (a member sees every
 * board in it), so the one role check gates the whole read. Each board's numbers
 * are correlated subqueries against that board, top-level tasks only (subtasks
 * complete with their parent — the analytics/epics rule), and "done" leans on
 * the board's designated done column (020): no done column, an honest 0.
 */
export async function getWorkspacePortfolio(
  actor: string | Principal,
  workspaceId: string
): Promise<Portfolio> {
  await requireWorkspaceRole(actor, workspaceId, "viewer");

  const boards = await query<PortfolioBoard>(
    `SELECT b.id, b.name,
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

  return summarizePortfolio(boards);
}
