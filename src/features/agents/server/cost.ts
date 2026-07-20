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
/** Micro-dollars per token, one rate per usage kind. */
interface Price {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

const OPUS_4_8: Price = {
  input: 5,
  output: 25,
  cacheRead: 0.5, // ~0.1x input
  cacheWrite: 6.25, // ~1.25x input
};

/**
 * The triage model §7.3 names, at $1 / $5 per MTok in / out (Claude API
 * reference) = 1 / 5 micro-dollars per token, same unit and ~0.1x/~1.25x cache
 * ratios as OPUS_4_8. Priced so a run routed here meters at real cost instead of
 * the opus fallback (which was ~5x too dear for a Haiku turn).
 */
const HAIKU_4_5: Price = {
  input: 1,
  output: 5,
  cacheRead: 0.1, // ~0.1x input
  cacheWrite: 1.25, // ~1.25x input
};

/** The per-model rate table, keyed by model id so a cheaper triage model
 *  (§7.3 names claude-haiku-4-5) meters at its own rate, not the opus fallback. */
const PRICES: Record<string, Price> = {
  "claude-opus-4-8": OPUS_4_8,
  "claude-haiku-4-5": HAIKU_4_5,
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
