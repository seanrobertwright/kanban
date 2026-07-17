import { queryOne } from "@/shared/db/client";
import { AuthzError } from "@/features/workspaces/server/authz";

/**
 * The per-workspace agent budget — §7.3's "non-negotiable" financial guardrail,
 * read two ways: as a boolean the run loop checks after every turn (isOverBudget),
 * and as an assertion the run-start endpoint makes before spending a cent
 * (assertUnderBudget).
 *
 * Spend is DERIVED, never stored (014): the runs are the truth, and a
 * denormalized counter would drift. cost_micros is a BIGINT, which node-postgres
 * returns as a *string* to avoid silently truncating past 2^53 — so SUM comes
 * back as text and is parsed here. Realistic monthly spend (a run is $0.15-0.30,
 * §7.3) stays far under that ceiling, so Number is exact.
 *
 * The window is the current calendar month, date_trunc'd on the server clock.
 * A month boundary that is an hour off in some zone does not matter to a spend
 * cap the way it would to an invoice — the cap exists to stop a runaway loop,
 * not to bill, and billing (§7.3, M6) will draw its own exact windows.
 */
export interface Budget {
  /** The cap in micro-dollars, or null when the workspace is uncapped (014). */
  capMicros: number | null;
  /** Micro-dollars spent by this workspace's runs so far this month. */
  spentMicros: number;
}

export async function getBudget(workspaceId: string): Promise<Budget> {
  const row = await queryOne<{ cap: string | null; spent: string }>(
    `SELECT w.agent_budget_micros AS cap,
            COALESCE(
              (SELECT SUM(cost_micros) FROM agent_run
                WHERE workspace_id = $1
                  AND created_at >= date_trunc('month', now())),
              0
            ) AS spent
       FROM workspace w
      WHERE w.id = $1`,
    [workspaceId]
  );
  // A workspace that does not exist has no budget to be over — the caller's
  // own authz has already resolved it, so this is defensive, not a real path.
  if (!row) return { capMicros: null, spentMicros: 0 };
  return {
    capMicros: row.cap === null ? null : Number(row.cap),
    spentMicros: Number(row.spent),
  };
}

/**
 * Has the workspace already spent its cap? Uncapped workspaces (cap null) never
 * are. This is the loop's per-turn gate: the run persists its accumulating
 * cost_micros before calling, so the sum here includes the run in progress —
 * which is the point, since it is the run in progress that might be running away.
 */
export async function isOverBudget(workspaceId: string): Promise<boolean> {
  const { capMicros, spentMicros } = await getBudget(workspaceId);
  return capMicros !== null && spentMicros >= capMicros;
}

/**
 * Refuse to *start* a run when the cap is already blown — the endpoint and
 * assignment paths call this before spending. A 'conflict' (409), matching the
 * repo's other invariant refusals (the last owner, a populated column): the
 * caller is permitted to assign an agent; the budget is a state that says not
 * right now, not a permission they lack.
 */
export async function assertUnderBudget(workspaceId: string): Promise<void> {
  if (await isOverBudget(workspaceId)) {
    throw new AuthzError(
      "conflict",
      "This workspace has reached its agent budget cap for the month"
    );
  }
}
