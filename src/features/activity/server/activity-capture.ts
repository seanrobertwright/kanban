import { AsyncLocalStorage } from "node:async_hooks";

/**
 * A capture sink for the id of the activity_log row a mutation produces.
 *
 * The problem it solves: an agent tool call (gate.ts) records its action in
 * `agent_action` on a POOLED connection, AFTER the mutation's own transaction has
 * already committed and returned. That mutation logged its activity_log row
 * (logActivity) inside a DIFFERENT connection's transaction, and returns an entity
 * (a Task, a Comment), not the activity id — so the id is unreachable by the time
 * `recordAction` needs it to populate `agent_action.activity_id` (013).
 *
 * Threading the id up through every mutation's return type would touch ~35 call
 * sites and change signatures shared with the human path. Instead we carry it out
 * of band: `logActivity` writes each id it mints into the active sink, and the
 * caller that opened the sink (the gate, the changeset-apply loop) reads it back
 * after the mutation returns. AsyncLocalStorage propagates the sink across every
 * await inside `run` without any parameter passing, and is invisible to callers
 * that never open one — the human path logs exactly as before.
 */
interface ActivitySink {
  /** The id of the LAST activity_log row logged within the capture, or null if
   *  the captured operation logged nothing (e.g. a dependency edge, which 018
   *  deliberately does not log). */
  activityId: string | null;
}

const storage = new AsyncLocalStorage<ActivitySink>();

/**
 * Run `fn`, capturing the id of the last activity_log row `logActivity` writes
 * within it. Returns the function's result alongside that id (null if none).
 *
 * "Last", not "all": every tool this wraps performs a single logged mutation, so
 * the last id is that mutation's. A hypothetical multi-log operation would report
 * only its final row — acceptable, since `agent_action` links to one activity, and
 * the tools that reach here (the auto tier, and changeset apply) each log once.
 */
export async function captureActivity<T>(
  fn: () => Promise<T>
): Promise<{ result: T; activityId: string | null }> {
  const sink: ActivitySink = { activityId: null };
  const result = await storage.run(sink, fn);
  return { result, activityId: sink.activityId };
}

/**
 * Record an activity_log id into the active capture, if any. Called by
 * `logActivity` for every row it appends; a no-op when nothing opened a sink, so
 * the human path (and any agent read) pays nothing.
 */
export function noteActivity(id: string): void {
  const sink = storage.getStore();
  if (sink) sink.activityId = id;
}
