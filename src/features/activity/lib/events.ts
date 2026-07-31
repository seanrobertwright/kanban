/**
 * The change feed's query contract (code review §4.4 item 8) — pure, so every
 * bound is stated in one place and can be asserted without a database.
 *
 * The feed exists because a stdio agent had exactly two ways to notice that
 * anything on its board had moved: re-read the whole board, or receive a
 * webhook it has no address to receive on. The first burns a context window per
 * poll; the second does not exist for a process behind stdio. A cursor over the
 * activity log is the cheap third way — the log is already written on every
 * mutation, already tenanted, and already ordered.
 *
 * Three decisions live here rather than in the handler:
 *
 *  - **`since` absent means "from now", not "from the beginning".** A first call
 *    answers with the head cursor and no events. Backfilling instead would pour
 *    a board's entire audit trail into the context of every agent that connects
 *    — the same blowup `list_board`'s size warning and the search cursors were
 *    added to avoid. An agent that genuinely wants history has task_history,
 *    which is scoped to a subject rather than to a clock.
 *  - **A cursor stays a string.** `activity_log.id` is BIGSERIAL; JSON numbers
 *    are IEEE doubles, so a busy instance would eventually round one and hand
 *    back a cursor that skips rows. It is only ever compared and echoed, never
 *    arithmetic, so the string costs nothing.
 *  - **`wait` clamps, `since` and `limit` refuse.** A malformed cursor is a bug
 *    in the caller that silently loses events if we guess at it, so it is a 400.
 *    A too-long wait is a caller *preference* the server is entitled to shorten,
 *    and answering "no" to "hold for 60s" would make every over-eager client a
 *    hard failure instead of a slightly chattier one.
 */

/** One page of the feed, big enough that a busy minute fits in a single poll. */
export const DEFAULT_EVENT_LIMIT = 50;
/** The ceiling on one page — the point is a nudge, not a bulk export. */
export const MAX_EVENT_LIMIT = 200;
/**
 * The longest a poll may hold the request open. Under the 30s a stock nginx,
 * Vercel or Cloudflare hop will cut a response at, so the timeout the caller
 * sees is ours (an empty 200 with a cursor it can reuse) rather than the
 * proxy's (a 504 that looks like an outage and loses the cursor).
 */
export const MAX_WAIT_SECONDS = 25;

export interface EventQuery {
  /** The last cursor the caller saw, or null for "start from now". */
  since: string | null;
  limit: number;
  waitSeconds: number;
}

/** A digits-only bigint, which is what the cursor is on the wire. Rejects the
 *  forms Number() would happily take and corrupt: "1e3", " 12", "12.0", "-1". */
const CURSOR = /^\d+$/;

export function parseEventQuery(
  params: URLSearchParams
): { query: EventQuery } | { error: string } {
  const rawSince = params.get("since");
  let since: string | null = null;
  if (rawSince !== null && rawSince !== "") {
    if (!CURSOR.test(rawSince)) {
      return { error: "since must be a cursor returned by a previous call" };
    }
    // Leading zeros would echo back a cursor that does not string-compare with
    // the one we issued, which matters to a client that dedupes on it.
    since = String(BigInt(rawSince));
  }

  const rawLimit = params.get("limit");
  let limit = DEFAULT_EVENT_LIMIT;
  if (rawLimit !== null && rawLimit !== "") {
    const parsed = Number(rawLimit);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_EVENT_LIMIT) {
      return { error: `limit must be an integer between 1 and ${MAX_EVENT_LIMIT}` };
    }
    limit = parsed;
  }

  const rawWait = params.get("wait");
  let waitSeconds = 0;
  if (rawWait !== null && rawWait !== "") {
    const parsed = Number(rawWait);
    if (!Number.isFinite(parsed)) {
      return { error: "wait must be a number of seconds" };
    }
    waitSeconds = Math.min(MAX_WAIT_SECONDS, Math.max(0, parsed));
  }

  return { query: { since, limit, waitSeconds } };
}
