import { asPrincipal } from "@/features/auth/server/principal";
import type { Principal } from "@/features/auth/server/principal";
import { AuthzError, requireBoardRole } from "@/features/workspaces/server/authz";
import { query, queryOne } from "@/shared/db/client";
import type { Timesheet, TimesheetApproval, TimesheetCell } from "../types";
import {
  buildTimesheetGrid,
  resolveWindow,
  weekStart,
} from "../lib/timesheet";

/**
 * A board's time_entry ledger (027) rolled up per contributor per day.
 *
 * Reporting, so viewer+ — an export is a read of what the board's tasks already
 * hold, and the analytics dialog's rule. The window is bounded (a grid is not a
 * data dump): a caller's from/to is honoured but the span is clamped to
 * MAX_TIMESHEET_DAYS, and an absent window defaults to the Mon–Sun week
 * containing today (CURRENT_DATE, so the default has no client-zone
 * dependency).
 *
 * The default is week-*aligned*, not merely week-sized, because sign-off is
 * keyed to `weekStart` (083): a rolling "last seven days" grid would let a
 * reviewer approve a week other than the one on screen.
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

  // Resolve the window against the database's today, so the default has no
  // client-zone dependency. The rule itself is pure and lives in the lib.
  const today = await queryOne<{ today: string }>(
    `SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD') AS today`
  );
  const { from, to } = resolveWindow(
    today!.today,
    asDate(opts.from),
    asDate(opts.to),
    MAX_TIMESHEET_DAYS
  );

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

/**
 * The verdicts on a board's weeks in a window (083).
 *
 * Read at viewer rank alongside the grid it annotates — who signed off on whose
 * week is exactly as sensitive as the minutes themselves, which the grid
 * already shows to any viewer.
 *
 * Overlapping rather than contained: an approval whose week merely intersects
 * [from, to] is returned, because the default window is seven days ending today
 * and would otherwise show a mid-week grid with no verdict on it at all.
 */
export async function listTimesheetApprovals(
  actor: string | Principal,
  boardId: number,
  from: string,
  to: string
): Promise<TimesheetApproval[]> {
  await requireBoardRole(actor, boardId, "viewer");
  return query<TimesheetApproval>(
    `SELECT a.id, a.board_id AS "boardId", a.user_id AS "userId",
            u.name AS "userName",
            to_char(a.week_start, 'YYYY-MM-DD') AS "weekStart",
            a.status, a.reviewed_by AS "reviewedBy", r.name AS "reviewerName",
            a.reviewed_at AS "reviewedAt", a.note
       FROM timesheet_approval a
       LEFT JOIN "user" u ON u.id = a.user_id
       LEFT JOIN "user" r ON r.id = a.reviewed_by
      WHERE a.board_id = $1
        AND a.week_start <= $3::date
        AND a.week_start + 6 >= $2::date
      ORDER BY a.week_start DESC, u.name, a.user_id`,
    [boardId, from, to]
  );
}

/**
 * A contributor declaring their own week finished.
 *
 * "member", and their *own* week only: submitting is a statement about work you
 * did, and one person cannot declare another's week complete on their behalf.
 * The reviewer fields stay null — a submission is not a review, and conflating
 * them would let a contributor approve themselves by submitting.
 *
 * Re-submitting after a rejection is the intended path (fix the entries, submit
 * again), so the upsert resets the verdict rather than refusing.
 */
export async function submitTimesheet(
  actor: string | Principal,
  boardId: number,
  day: string
): Promise<TimesheetApproval> {
  const principal = asPrincipal(actor);
  await requireBoardRole(actor, boardId, "member");
  if (principal.kind !== "human") {
    // Time tracking is humans-only (027); an agent has no week to submit.
    throw new AuthzError("forbidden", "Only people submit timesheets");
  }
  const monday = weekStart(assertDay(day));

  await query(
    `INSERT INTO timesheet_approval (board_id, user_id, week_start, status)
     VALUES ($1, $2, $3::date, 'submitted')
     ON CONFLICT (board_id, user_id, week_start) DO UPDATE
        SET status = 'submitted', reviewed_by = NULL, reviewed_at = NULL,
            note = '', updated_at = now()`,
    [boardId, principal.userId, monday]
  );
  return (await one(actor, boardId, principal.userId, monday))!;
}

/**
 * A reviewer's verdict on someone's week.
 *
 * "admin" — the same rank that deletes a column, for §7.4's blast-radius
 * reason: an approval is what a client invoice or a capacity plan is built on,
 * so it is not an ordinary member's edit. A rejection carries a note, because a
 * rejection without one leaves the contributor with nothing to act on.
 *
 * There is no self-review guard. An admin approving their own week is a real
 * workflow in a small team, and the row records *who* reviewed it — which is
 * the fact an auditor needs. A rule that only bites the one-admin case would
 * make the feature unusable there while proving nothing anywhere else.
 */
export async function reviewTimesheet(
  actor: string | Principal,
  boardId: number,
  userId: string,
  day: string,
  verdict: "approved" | "rejected",
  note = ""
): Promise<TimesheetApproval> {
  const principal = asPrincipal(actor);
  await requireBoardRole(actor, boardId, "admin");
  if (principal.kind !== "human") {
    throw new AuthzError("forbidden", "Only people review timesheets");
  }
  if (verdict === "rejected" && !note.trim()) {
    throw new AuthzError("conflict", "A rejection needs a reason");
  }
  const monday = weekStart(assertDay(day));

  // Upsert, not update: a reviewer may sign off a week the contributor never
  // formally submitted, which is the common case on a team that does not use
  // the submit step at all.
  await query(
    `INSERT INTO timesheet_approval
       (board_id, user_id, week_start, status, reviewed_by, reviewed_at, note)
     VALUES ($1, $2, $3::date, $4, $5, now(), $6)
     ON CONFLICT (board_id, user_id, week_start) DO UPDATE
        SET status = EXCLUDED.status, reviewed_by = EXCLUDED.reviewed_by,
            reviewed_at = now(), note = EXCLUDED.note, updated_at = now()`,
    [boardId, userId, monday, verdict, principal.userId, note.trim().slice(0, 1000)]
  );
  return (await one(actor, boardId, userId, monday))!;
}

/** Read back one row — the shape both writers return. */
async function one(
  actor: string | Principal,
  boardId: number,
  userId: string,
  monday: string
): Promise<TimesheetApproval | undefined> {
  const rows = await listTimesheetApprovals(actor, boardId, monday, monday);
  return rows.find((r) => r.userId === userId && r.weekStart === monday);
}

/** A caller-supplied day must be a real 'YYYY-MM-DD' before it names a week. */
function assertDay(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new AuthzError("conflict", "week must be a YYYY-MM-DD date");
  }
  return value;
}
