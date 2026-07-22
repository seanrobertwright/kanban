import type { Principal } from "@/features/auth/server/principal";
import { query, queryOne } from "@/shared/db/client";
import {
  AuthzError,
  requireBoardRole,
} from "@/features/workspaces/server/authz";
import { costOf, remainingOf } from "../lib/budget";
import type {
  BoardBudget,
  BudgetContributor,
  SetBoardBudgetInput,
} from "../types";

/**
 * Budget / financial planning (042).
 *
 * The budget is viewer+ (a read of the project's money, the analytics/timesheet
 * rule). Setting it is admin — a project's budget and labour rate are financial
 * decisions about the board, the rank board-structure changes ask for.
 *
 * Spend is derived, never stored: the time_entry ledger (027) rolled up to
 * minutes, costed at the board's hourly rate. Humans-only holds by construction —
 * time_entry only records a human session — so the contributor breakdown is a
 * real per-person labour cost. No activity log: a budget figure is planning
 * config, not a task event (portfolio / capacity precedent).
 */

interface BudgetRow {
  budgetAmount: number | null;
  hourlyRate: number;
  currency: string;
}

export async function getBoardBudget(
  actor: string | Principal,
  boardId: number
): Promise<BoardBudget> {
  await requireBoardRole(actor, boardId, "viewer");

  const board = await queryOne<BudgetRow>(
    `SELECT budget_amount AS "budgetAmount", hourly_rate AS "hourlyRate", currency
       FROM board WHERE id = $1`,
    [boardId]
  );
  if (!board) throw new AuthzError("not_found", "Board not found");

  // Logged minutes per contributor, board-scoped (the timesheet join). LEFT JOIN
  // to user so a name is resolved; ordered so the biggest spender leads.
  const rows = await query<{ userId: string; name: string; minutes: number }>(
    `SELECT te.user_id AS "userId", u.name,
            SUM(te.minutes)::int AS minutes
       FROM time_entry te
       JOIN task t ON t.id = te.task_id
       JOIN board_column bc ON bc.id = t.column_id
       LEFT JOIN "user" u ON u.id = te.user_id
      WHERE bc.board_id = $1
      GROUP BY te.user_id, u.name
      ORDER BY minutes DESC, u.name`,
    [boardId]
  );

  const contributors: BudgetContributor[] = rows.map((r) => ({
    userId: r.userId,
    name: r.name,
    minutes: r.minutes,
    cost: costOf(r.minutes, board.hourlyRate),
  }));
  const loggedMinutes = contributors.reduce((acc, c) => acc + c.minutes, 0);
  const spend = costOf(loggedMinutes, board.hourlyRate);

  return {
    budgetAmount: board.budgetAmount,
    hourlyRate: board.hourlyRate,
    currency: board.currency,
    loggedMinutes,
    spend,
    remaining: remainingOf(board.budgetAmount, spend),
    contributors,
  };
}

/**
 * Sets the board's budget, rate, and currency (admin). Each field is optional;
 * budgetAmount is three-valued (026's dueDate shape) — absent leaves it, null
 * clears to "no budget", a number sets it.
 */
export async function setBoardBudget(
  actor: string | Principal,
  boardId: number,
  input: SetBoardBudgetInput
): Promise<BoardBudget> {
  await requireBoardRole(actor, boardId, "admin");

  const setsBudget = "budgetAmount" in input;
  await query(
    `UPDATE board
        SET budget_amount = CASE WHEN $2::boolean THEN $3::float8 ELSE budget_amount END,
            hourly_rate = COALESCE($4, hourly_rate),
            currency = COALESCE($5, currency)
      WHERE id = $1`,
    [
      boardId,
      setsBudget,
      input.budgetAmount ?? null,
      input.hourlyRate ?? null,
      input.currency?.trim() || null,
    ]
  );

  return getBoardBudget(actor, boardId);
}
