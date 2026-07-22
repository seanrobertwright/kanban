import { query } from "@/shared/db/client";
import { executeRun } from "./runtime";

/**
 * The durable half of the run queue (013, §7.1's "recoverable run").
 *
 * dispatchRun (runtime.ts) kicks a queued run off the request path with Next's
 * after() — fast and in-process, but only as durable as the process: a crash or
 * deploy between the enqueue COMMIT and the callback strands the run. 013 made the
 * run a record precisely so it could be "the endpoint's or a future worker's to
 * pick up" — this is that worker. It sweeps on an interval and re-dispatches what
 * after() dropped, so a run is guaranteed to make progress even if no single
 * process survives to run it.
 *
 * Two failure modes, both swept:
 *   - queued, never picked up — the after() kick never fired (no request scope, or
 *     the process died before it ran). Re-dispatched once it is older than the
 *     grace period, which keeps the sweep from racing a healthy in-flight kick.
 *   - running, then abandoned — the loop was turning and the process died. Its
 *     heartbeat (030) stops advancing; once it is stale past the crash threshold
 *     the run is provably dead, so it is reset to 'queued' and re-dispatched.
 *
 * Re-dispatch is safe against a live worker because executeRun claims atomically
 * (queued → running only if still queued): if the original kick is somehow still
 * alive, one of the two claims wins and the other returns. Requeuing a crashed
 * 'running' run does restart its loop from the top — at-least-once, not
 * exactly-once — which can repeat side effects (a comment, a proposal). That is
 * the deliberate trade: a stalled-forever run is worse than a re-run one, and the
 * crash threshold is set long enough that only a genuinely dead run is swept.
 */

const num = (name: string, fallback: number): number => {
  const raw = process.env[name];
  const n = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/** How often the sweep runs. */
const TICK_MS = num("RUN_DRAINER_INTERVAL_MS", 30_000);
/** A queued run younger than this is left for its after() kick — only an orphan
 *  older than the grace window is re-dispatched, so a healthy enqueue is not
 *  double-run the instant it commits. */
const QUEUED_GRACE_SECONDS = num("RUN_DRAINER_QUEUED_GRACE_SECONDS", 60);
/** A running run whose heartbeat is older than this is treated as crashed. Well
 *  above a normal turn's duration so a slow-but-live run is never yanked. */
const RUNNING_STALE_SECONDS = num("RUN_DRAINER_RUNNING_STALE_SECONDS", 600);
/** A safety bound on one tick's re-dispatch fan-out, so a backlog drains steadily
 *  over several ticks rather than launching hundreds of loops at once. */
const BATCH = num("RUN_DRAINER_BATCH", 20);

/**
 * Reset abandoned 'running' runs to 'queued', then re-dispatch stale 'queued'
 * ones. Exposed for tests to invoke a single sweep deterministically; the
 * interval (startRunDrainer) just calls it on a timer. Swallows and logs its own
 * errors so one bad tick never kills the loop.
 */
export async function drainOnce(): Promise<number> {
  try {
    // A crashed 'running' run: reset it to 'queued'. It is dispatched immediately
    // below, NOT held for the grace window — grace only guards against racing a
    // healthy after() kick, and a crashed run has none pending. It keeps its
    // original (old) created_at, so it does not resurface in the orphan query,
    // which is why it is dispatched directly here.
    const revived = await query<{ id: string }>(
      `UPDATE agent_run
          SET status = 'queued'
        WHERE status = 'running'
          AND last_heartbeat_at IS NOT NULL
          AND last_heartbeat_at < now() - ($1 * interval '1 second')
        RETURNING id`,
      [RUNNING_STALE_SECONDS]
    );
    if (revived.length > 0) {
      console.warn(
        `run drainer: requeued ${revived.length} crashed run(s): ${revived
          .map((r) => r.id)
          .join(", ")}`
      );
    }

    // Never-picked-up 'queued' runs older than the grace window — the after() kick
    // either never fired or died before it ran.
    const orphans = await query<{ id: string }>(
      `SELECT id FROM agent_run
        WHERE status = 'queued'
          AND created_at < now() - ($1 * interval '1 second')
        ORDER BY created_at
        LIMIT ${BATCH}`,
      [QUEUED_GRACE_SECONDS]
    );

    // Serial, not concurrent: each executeRun drives a full agent loop, and a
    // drainer that fanned them all out at once would be the runaway it exists to
    // prevent. executeRun claims atomically, so a run a live kick grabs first — or
    // one that appears in both lists — is a cheap no-op on the redundant call.
    const ids = new Set<string>([
      ...revived.map((r) => r.id),
      ...orphans.map((o) => o.id),
    ]);
    for (const id of ids) {
      await executeRun(id);
    }

    // Recurring automation rules (047, rock 1.4) ride this same sweep — the
    // scheduler fires any schedule.tick rule whose next_run_at has passed.
    // Dynamically imported so the agent drainer does not statically pull in the
    // automation engine's graph; its own errors are swallowed inside the tick.
    try {
      const { tickScheduledAutomations } = await import(
        "@/features/automations/server/scheduler"
      );
      await tickScheduledAutomations();
    } catch (error) {
      console.error("automation scheduler tick failed", error);
    }

    // SLA timers (050, rock 1.6) ride the same sweep — start new timers for
    // matching tasks, breach the overdue, and fire their escalation actions.
    try {
      const { sweepSlas } = await import("@/features/sla/server/sweep");
      await sweepSlas();
    } catch (error) {
      console.error("sla sweep tick failed", error);
    }

    return ids.size;
  } catch (error) {
    console.error("run drainer tick failed", error);
    return 0;
  }
}

interface DrainerGlobal {
  __kanbanRunDrainer?: boolean;
}

/**
 * Start the sweep on an interval. Idempotent per process — a globalThis latch
 * stops a dev-server hot reload (or a double register()) from stacking timers. The
 * timer is unref'd so it never by itself holds the process open.
 */
export function startRunDrainer(): void {
  const g = globalThis as unknown as DrainerGlobal;
  if (g.__kanbanRunDrainer) return;
  g.__kanbanRunDrainer = true;

  const timer = setInterval(() => {
    void drainOnce();
  }, TICK_MS);
  timer.unref?.();
  console.error(`run drainer started (every ${TICK_MS}ms)`);
}
