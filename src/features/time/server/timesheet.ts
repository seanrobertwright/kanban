import type { Principal } from "@/features/auth/server/principal";
import { requireBoardRole } from "@/features/workspaces/server/authz";
import { query, queryOne } from "@/shared/db/client";
import type { Timesheet, TimesheetCell } from "../types";
import { addDays, buildTimesheetGrid } from "../lib/timesheet";

/**
 * A board's time_entry ledger (027) rolled up per contributor per day.
 *
 * Reporting, so viewer+ — an export is a read of what the board's tasks already
 * hold, and the analytics dialog's rule. The window is bounded (a grid is not a
 * data dump): a caller's from/to is honoured but the span is clamped to
 * MAX_TIMESHEET_DAYS, and an absent window defaults to the week ending today
 * (CURRENT_DATE, so the default has no client-zone dependency).
 */

const MAX_TIMESHEET_DAYS = 31;

/** Validate a caller-supplied 'YYYY-MM-DD'; anything else is treated as absent. */
function asDate(value: string | null | undefined): string | null {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

export async function getBoardTimesheet(
  actor: string | Principal,
  boardId: number,
  opts: { from?: string | null; to?: string | null } = {}
): Promise<Timesheet> {
  await requireBoardRole(actor, boardId, "viewer");

  // Resolve the window. `to` defaults to today; `from` to six days before it —
  // a Mon–Sun-sized week. Both are then clamped so the span never exceeds the
  // bound, trimming `from` up toward `to` (the recent end is the useful one).
  const today = await queryOne<{ today: string }>(
    `SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD') AS today`
  );
  const to = asDate(opts.to) ?? today!.today;
  let from = asDate(opts.from) ?? addDays(to, -6);
  if (from > to) from = to;
  if (addDays(from, MAX_TIMESHEET_DAYS - 1) < to) {
    from = addDays(to, -(MAX_TIMESHEET_DAYS - 1));
  }

  // Board-scoped rollup: join each entry to its task's board, group by
  // contributor and day. Humans-only holds by construction — time_entry only
  // ever records a human session (027) — so a row is always a person.
  const cells = await query<TimesheetCell>(
    `SELECT te.user_id AS "userId",
            u.name AS "userName",
            te.spent_on AS "spentOn",
            SUM(te.minutes)::int AS minutes
       FROM time_entry te
       JOIN task t ON t.id = te.task_id
       JOIN board_column bc ON bc.id = t.column_id
       LEFT JOIN "user" u ON u.id = te.user_id
      WHERE bc.board_id = $1 AND te.spent_on BETWEEN $2 AND $3
      GROUP BY te.user_id, u.name, te.spent_on`,
    [boardId, from, to]
  );

  return buildTimesheetGrid(from, to, cells);
}
