/**
 * The money maths of budget/financial planning (042), split from the DB read so
 * the derivation is unit-testable and can change without a migration (spend is
 * derived, never stored — priority_score's rule).
 */

/** Round to cents — money is displayed to two places, so derive it that way. */
export function toCents(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Cost of a span of logged minutes at an hourly rate, rounded to cents. */
export function costOf(minutes: number, hourlyRate: number): number {
  return toCents((minutes / 60) * hourlyRate);
}

/** What is left of the budget after spend, or null when no budget is set — a
 *  spend with nothing to measure it against has no "remaining". */
export function remainingOf(
  budgetAmount: number | null,
  spend: number
): number | null {
  return budgetAmount === null ? null : toCents(budgetAmount - spend);
}

/** Spend as a fraction of budget, or null when no budget (or a zero budget) —
 *  the utilization guard, so a fresh project reads no bar rather than NaN. */
export function budgetUtilization(
  budgetAmount: number | null,
  spend: number
): number | null {
  if (budgetAmount === null || budgetAmount <= 0) return null;
  return spend / budgetAmount;
}
