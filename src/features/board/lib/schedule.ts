import type { Task } from "@/features/tasks/types";
import type { TaskDependencyEdge } from "@/features/dependencies/types";

/**
 * Scheduling maths shared by the Timeline (032) and the Gantt (036).
 *
 * All calendar work is done on 'YYYY-MM-DD' strings in UTC, the discipline 006,
 * due-date.ts and the calendar all keep: a zoneless date must never pass through
 * `new Date()` in the server's local zone, where it silently becomes a midnight
 * that serializes to the wrong day east of Greenwich. Only the *window* below
 * touches Date, and only to step day counts — a task's own dates stay strings.
 */

const MONTH_ABBR = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const pad = (n: number) => String(n).padStart(2, "0");

/** `iso` shifted by `n` whole days, still 'YYYY-MM-DD'. */
export function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/** Whole days from `a` to `b` (b − a); negative when b precedes a. */
export function dayDiff(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round(
    (Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000
  );
}

/** "Mar 3" — a short, zone-free label read straight off the string. */
export function shortLabel(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${MONTH_ABBR[m - 1]} ${d}`;
}

/**
 * A task's span on the timeline: [start, end] as 'YYYY-MM-DD'. A task with both
 * dates spans them; one with only a start (or only a due) is a zero-length span
 * on that single day. Returns null for a task with neither date, which has no
 * place on a timeline. A backwards pair (start after due) is ordered so the span
 * always reads forward — YYYY-MM-DD sorts as dates, so no Date is needed.
 */
export function spanOf(task: Task): [string, string] | null {
  const start = task.startDate ?? task.dueDate;
  const end = task.dueDate ?? task.startDate;
  if (!start || !end) return null;
  return start <= end ? [start, end] : [end, start];
}

/** A task's duration in whole days, inclusive of both endpoints (≥ 1). */
export function durationOf(span: [string, string]): number {
  return dayDiff(span[0], span[1]) + 1;
}

/**
 * The result of a critical-path pass over the scheduled tasks and their
 * dependency edges: which tasks and which edges lie on a schedule-driving path.
 */
export interface CriticalPath {
  /** Task ids on some longest (by total duration) dependency chain. */
  nodes: Set<number>;
  /** Edge keys `${blockerId}->${dependentId}` connecting two critical tasks. */
  edges: Set<string>;
}

/** The edge key an arrow and a critical-edge check agree on. */
export function edgeKey(blockerId: number, dependentId: number): string {
  return `${blockerId}->${dependentId}`;
}

/**
 * The critical path through a set of scheduled tasks (036) — the classic CPM
 * longest-path, weighted by each task's own duration.
 *
 * A dependency edge {taskId, dependsOnId} means dependsOnId (the blocker) must
 * finish before taskId (the dependent) — so the blocker precedes the dependent
 * in the DAG. The longest chain of such precedences, summed by duration, is the
 * work that drives the schedule: shortening anything off it buys nothing.
 *
 *   longestTo[v]   = duration[v] + max(longestTo[pred])   — chain ending at v
 *   longestFrom[v] = duration[v] + max(longestFrom[succ]) — chain starting at v
 *   a node is critical when longestTo[v] + longestFrom[v] − duration[v] == max
 *
 * Only tasks in `durations` count as nodes; an edge touching a task off the
 * board (a subtask never rendered here) is dropped. With no edges there is no
 * chain to speak of, so the path is empty — the Gantt then reads as a plain
 * timeline with no arrows and nothing highlighted.
 *
 * addDependency forbids cycles, but this must not loop if a stray one reaches it
 * (a subtask edge, hand-edited data): the memoised walks carry a visiting set and
 * treat a back-edge as a zero contribution rather than recursing forever.
 */
export function criticalPath(
  durations: Map<number, number>,
  allEdges: TaskDependencyEdge[]
): CriticalPath {
  const empty: CriticalPath = { nodes: new Set(), edges: new Set() };

  // Keep only edges whose both ends are scheduled tasks we are drawing.
  const edges = allEdges.filter(
    (e) => durations.has(e.taskId) && durations.has(e.dependsOnId)
  );
  if (edges.length === 0) return empty;

  const preds = new Map<number, number[]>();
  const succs = new Map<number, number[]>();
  for (const id of durations.keys()) {
    preds.set(id, []);
    succs.set(id, []);
  }
  for (const { taskId: dependent, dependsOnId: blocker } of edges) {
    preds.get(dependent)!.push(blocker);
    succs.get(blocker)!.push(dependent);
  }

  const dur = (id: number) => durations.get(id) ?? 0;

  // Longest chain ending at / starting from a node, memoised. `visiting` guards
  // a stray cycle: a node reached while still on the stack contributes 0.
  const memoTo = new Map<number, number>();
  const longestTo = (id: number, visiting: Set<number>): number => {
    const cached = memoTo.get(id);
    if (cached !== undefined) return cached;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    let best = 0;
    for (const p of preds.get(id) ?? []) {
      best = Math.max(best, longestTo(p, visiting));
    }
    visiting.delete(id);
    const total = dur(id) + best;
    memoTo.set(id, total);
    return total;
  };

  const memoFrom = new Map<number, number>();
  const longestFrom = (id: number, visiting: Set<number>): number => {
    const cached = memoFrom.get(id);
    if (cached !== undefined) return cached;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    let best = 0;
    for (const s of succs.get(id) ?? []) {
      best = Math.max(best, longestFrom(s, visiting));
    }
    visiting.delete(id);
    const total = dur(id) + best;
    memoFrom.set(id, total);
    return total;
  };

  let max = 0;
  for (const id of durations.keys()) {
    max = Math.max(max, longestTo(id, new Set()));
  }

  const nodes = new Set<number>();
  for (const id of durations.keys()) {
    const through =
      longestTo(id, new Set()) + longestFrom(id, new Set()) - dur(id);
    if (through === max) nodes.add(id);
  }

  // An edge is critical when it joins two critical tasks adjacently on a longest
  // chain: the blocker's chain plus the dependent's own duration reaches exactly
  // the dependent's chain length.
  const criticalEdges = new Set<string>();
  for (const { taskId: dependent, dependsOnId: blocker } of edges) {
    if (!nodes.has(dependent) || !nodes.has(blocker)) continue;
    if (
      longestTo(blocker, new Set()) + dur(dependent) ===
      longestTo(dependent, new Set())
    ) {
      criticalEdges.add(edgeKey(blocker, dependent));
    }
  }

  return { nodes, edges: criticalEdges };
}
