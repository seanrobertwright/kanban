/**
 * Token prices for the agent loop, in MICRO-DOLLARS per token — the unit
 * agent_run.cost_micros and workspace.agent_budget_micros are stored in (013,
 * 014), chosen so these rates are clean integers and the whole meter is exact.
 *
 * From the Claude API reference (§7.3, cached 2026-06-24): claude-opus-4-8 is
 * $5 / $25 per MTok in / out. $5 per 1,000,000 tokens = 5 micro-dollars per
 * token. Cache reads bill at ~0.1x fresh input, and cache writes at ~1.25x —
 * §7.3 calls prompt caching "load-bearing" precisely because the board-context
 * prefix is re-read every turn, so pricing those tokens at the fresh-input rate
 * would overstate a multi-turn run's cost by roughly 10x.
 */
const OPUS_4_8 = {
  input: 5,
  output: 25,
  cacheRead: 0.5, // ~0.1x input
  cacheWrite: 6.25, // ~1.25x input
} as const;

/** The per-model rate table. One entry today; keyed by model id so a cheaper
 *  triage model (§7.3 names claude-haiku-4-5) slots in without touching callers. */
const PRICES: Record<string, typeof OPUS_4_8> = {
  "claude-opus-4-8": OPUS_4_8,
};

/** The token counts one turn reports, straight off `usage`. */
export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

/**
 * The micro-dollar cost of one turn's usage. Unknown models fall back to the
 * opus rate rather than to zero — an unmetered run is a worse failure than a
 * mispriced one, given §7.3 makes the cap "non-negotiable". Rounded to a whole
 * micro-dollar because the column is BIGINT and fractional micros are noise.
 */
export function costMicros(model: string, usage: Usage): number {
  const p = PRICES[model] ?? OPUS_4_8;
  return Math.round(
    usage.inputTokens * p.input +
      usage.outputTokens * p.output +
      usage.cacheReadTokens * p.cacheRead +
      usage.cacheCreationTokens * p.cacheWrite
  );
}
