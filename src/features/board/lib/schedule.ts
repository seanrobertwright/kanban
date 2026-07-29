import type { Task } from "@/features/tasks/types";
import type {
  DependencyLink,
  TaskDependencyEdge,
} from "@/features/dependencies/types";

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
 * How many days after the blocker's start the dependent may start, for one
 * typed edge (087). This is the whole of what a link type means to the schedule.
 *
 * Durations are inclusive day counts, so a task starting on day `s` with
 * duration `d` finishes on day `s + d − 1`. Writing each type's constraint that
 * way and solving for the dependent's start collapses all three to the same
 * shape — `start_dependent ≥ start_blocker + w` — which is why nothing
 * downstream needs to branch on the type again:
 *
 *   FS  start_d ≥ finish_b + 1 + lag  →  w = dur_b + lag
 *   SS  start_d ≥ start_b + lag       →  w = lag
 *   FF  finish_d ≥ finish_b + lag     →  w = dur_b − dur_d + lag
 *
 * The weight is signed. A lead makes it smaller, and FF between a short blocker
 * and a long dependent is negative even at zero lag — correctly, since a task
 * that must merely *finish* alongside a shorter one may start well before it.
 */
function edgeWeight(
  link: DependencyLink,
  blockerDuration: number,
  dependentDuration: number
): number {
  if (link.type === "SS") return link.lagDays;
  if (link.type === "FF") return blockerDuration - dependentDuration + link.lagDays;
  return blockerDuration + link.lagDays;
}

/**
 * The critical path through a set of scheduled tasks (036, typed at 087) — CPM's
 * forward/backward pass over the dependency DAG.
 *
 * A dependency edge {taskId, dependsOnId} means dependsOnId (the blocker)
 * constrains taskId (the dependent), so the blocker precedes it in the DAG. Each
 * edge carries a minimum offset in days (edgeWeight above); the schedule-driving
 * work is the chain where those offsets leave no slack, because shortening
 * anything off it buys nothing.
 *
 *   earlyStart[v] = max(0, max over blockers b of earlyStart[b] + w(b→v))
 *   projectEnd    = max over v of earlyStart[v] + duration[v]
 *   lateStart[v]  = min(projectEnd − duration[v],
 *                       min over dependents s of lateStart[s] − w(v→s))
 *   v is critical when it has no float at all: lateStart[v] == earlyStart[v]
 *
 * Before 087 this was the same computation stated in duration sums, which is
 * only equivalent while every link is finish-to-start with no lag — there
 * w collapses to duration[b] and earlyStart[v] becomes "longest chain of
 * durations before v". Those boards are unaffected; the general form is what
 * lets an SS or a lead move the path.
 *
 * Only tasks in `durations` count as nodes; an edge touching a task off the
 * board (a subtask never rendered here) is dropped. With no edges there is no
 * chain to speak of, so the path is empty — the Gantt then reads as a plain
 * timeline with no arrows and nothing highlighted.
 *
 * addDependency forbids cycles, but this must not loop if a stray one reaches it
 * (a subtask edge, hand-edited data): the memoised walks carry a visiting set and
 * treat a back-edge as a neutral contribution rather than recursing forever.
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

  const dur = (id: number) => durations.get(id) ?? 0;

  interface Link {
    other: number;
    weight: number;
  }
  const preds = new Map<number, Link[]>();
  const succs = new Map<number, Link[]>();
  for (const id of durations.keys()) {
    preds.set(id, []);
    succs.set(id, []);
  }
  for (const edge of edges) {
    const { taskId: dependent, dependsOnId: blocker } = edge;
    const weight = edgeWeight(edge, dur(blocker), dur(dependent));
    preds.get(dependent)!.push({ other: blocker, weight });
    succs.get(blocker)!.push({ other: dependent, weight });
  }

  // Forward pass. Floored at 0: nothing starts before the project does, which is
  // what a negative weight into an otherwise unconstrained task would ask for.
  const memoEarly = new Map<number, number>();
  const earlyStart = (id: number, visiting: Set<number>): number => {
    const cached = memoEarly.get(id);
    if (cached !== undefined) return cached;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    let start = 0;
    for (const { other, weight } of preds.get(id) ?? []) {
      start = Math.max(start, earlyStart(other, visiting) + weight);
    }
    visiting.delete(id);
    const total = Math.max(0, start);
    memoEarly.set(id, total);
    return total;
  };

  let projectEnd = 0;
  for (const id of durations.keys()) {
    projectEnd = Math.max(projectEnd, earlyStart(id, new Set()) + dur(id));
  }

  // Backward pass. A task with no dependents is only bounded by the project's
  // own end, which is what makes the longest chain the one with zero float.
  const memoLate = new Map<number, number>();
  const lateStart = (id: number, visiting: Set<number>): number => {
    const cached = memoLate.get(id);
    if (cached !== undefined) return cached;
    if (visiting.has(id)) return projectEnd - dur(id);
    visiting.add(id);
    let latest = projectEnd - dur(id);
    for (const { other, weight } of succs.get(id) ?? []) {
      latest = Math.min(latest, lateStart(other, visiting) - weight);
    }
    visiting.delete(id);
    memoLate.set(id, latest);
    return latest;
  };

  const nodes = new Set<number>();
  for (const id of durations.keys()) {
    if (lateStart(id, new Set()) === earlyStart(id, new Set())) nodes.add(id);
  }

  // An edge is critical when it joins two float-free tasks and is itself tight:
  // the dependent starts exactly as early as this edge allows, so a day's slip
  // on the blocker is a day's slip on the dependent.
  const criticalEdges = new Set<string>();
  for (const edge of edges) {
    const { taskId: dependent, dependsOnId: blocker } = edge;
    if (!nodes.has(dependent) || !nodes.has(blocker)) continue;
    const weight = edgeWeight(edge, dur(blocker), dur(dependent));
    if (
      earlyStart(blocker, new Set()) + weight ===
      earlyStart(dependent, new Set())
    ) {
      criticalEdges.add(edgeKey(blocker, dependent));
    }
  }

  return { nodes, edges: criticalEdges };
}
