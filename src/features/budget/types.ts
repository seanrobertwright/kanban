/**
 * Budget / financial planning (042). A board (a project) carries a budget, a
 * labour rate, and a currency; spend is derived from the time_entry ledger (027)
 * — logged hours × the rate — never stored, so it moves only as real work is
 * logged (priority_score's derive-don't-store rule, 034).
 */

/** One contributor's share of the spend — their logged time costed at the rate. */
export interface BudgetContributor {
  userId: string;
  name: string;
  minutes: number;
  cost: number;
}

export interface BoardBudget {
  /** The project's budget, or null when none is set. */
  budgetAmount: number | null;
  /** Cost per logged hour. */
  hourlyRate: number;
  /** Display currency code, e.g. "USD". */
  currency: string;
  /** Total minutes logged against the board (time_entry, 027). */
  loggedMinutes: number;
  /** Derived: loggedMinutes / 60 × hourlyRate, rounded to cents. */
  spend: number;
  /** Derived: budgetAmount − spend, or null when no budget is set. */
  remaining: number | null;
  /** Per-person spend, highest first. */
  contributors: BudgetContributor[];
}

export interface SetBoardBudgetInput {
  budgetAmount?: number | null;
  hourlyRate?: number;
  currency?: string;
}

export const CURRENCY_MAX = 8;
/** A budget or rate above this is a data-entry slip, not a plan. */
export const MONEY_MAX = 1_000_000_000;
