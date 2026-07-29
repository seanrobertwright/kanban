import { addDays } from "./schedule";
import {
  DEFAULT_LINK,
  lagLabel,
  type DependencyLink,
  type TaskDependencyEdge,
} from "@/features/dependencies/types";

export interface SchedulableTask {
  id: number;
  title: string;
  estimate: number | null;
  startDate: string | null;
  dueDate: string | null;
  assigneeId: string | null;
}
export interface ScheduleProposal {
  taskId: number;
  startDate: string;
  dueDate: string;
  reasons: string[];
}

/** Where a task lands once placed — both ends, because a typed link can hang
 * off either one. Before 087 only the end was ever read back. */
interface Span {
  start: string;
  end: string;
}

/**
 * The earliest this task may start, given one blocker's placed span and what the
 * link between them means (087).
 *
 * `days` is the dependent's own length, and only finish-to-finish needs it: that
 * link constrains where the dependent *ends*, so its start is that date walked
 * back across its duration. This is the calendar-date twin of `edgeWeight` in
 * schedule.ts, which states the same three rules as day offsets for the critical
 * path. The two must agree — a proposal the Gantt then contradicts is worse than
 * no proposal — so they are written to be read side by side.
 */
function earliestStart(
  link: DependencyLink,
  blocker: Span,
  days: number
): string {
  if (link.type === "SS") return addDays(blocker.start, link.lagDays);
  if (link.type === "FF")
    return addDays(addDays(blocker.end, link.lagDays), -(days - 1));
  return addDays(blocker.end, 1 + link.lagDays);
}

/** "after dependency #12" for a plain link, "after dependency #12 (SS+2d)" when
 * the link is doing something the reader would not otherwise guess from dates. */
function dependencyReason(id: number, link: DependencyLink): string {
  const plain =
    link.type === DEFAULT_LINK.type && link.lagDays === DEFAULT_LINK.lagDays;
  return plain
    ? `after dependency #${id}`
    : `after dependency #${id} (${link.type}${lagLabel(link.lagDays)})`;
}

/**
 * Deterministic proposal only: dependencies win, then each assignee is
 * sequenced. Writes nothing — the caller reports it and a human sets the dates
 * they agree with.
 *
 * `weeklyPointsByAssignee` makes the otherwise deterministic plan capacity
 * aware. A task's estimate remains its point demand; the member's weekly budget
 * turns that demand into a calendar duration. Missing/zero capacity deliberately
 * preserves the legacy one-point-per-day proposal rather than inventing a
 * budget.
 *
 * Each task is placed once and memoised, its blockers placed first by recursion.
 * `visiting` guards a stray cycle the DAG rule should have prevented: a task
 * reached while still on the stack contributes the project start rather than
 * recursing forever.
 */
export function proposeSchedule(
  tasks: SchedulableTask[],
  edges: TaskDependencyEdge[],
  start = new Date().toISOString().slice(0, 10),
  weeklyPointsByAssignee: ReadonlyMap<string, number> = new Map()
): ScheduleProposal[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));

  // Blockers per task, each carrying the link that says how to read it. An edge
  // touching a task outside this set is dropped — a blocker that is not being
  // scheduled has no span to measure against.
  const blockers = new Map<number, TaskDependencyEdge[]>();
  for (const edge of edges) {
    if (!byId.has(edge.taskId) || !byId.has(edge.dependsOnId)) continue;
    const list = blockers.get(edge.taskId);
    if (list) list.push(edge);
    else blockers.set(edge.taskId, [edge]);
  }

  const spans = new Map<number, Span>();
  /** How far each assignee is already committed, so one person's tasks queue. */
  const lanes = new Map<string, string>();
  const out: ScheduleProposal[] = [];

  const visit = (task: SchedulableTask, visiting = new Set<number>()): Span => {
    const placed = spans.get(task.id);
    if (placed) return placed;
    if (visiting.has(task.id)) return { start, end: start };
    visiting.add(task.id);

    // The task's own length, resolved before the blocker walk because a
    // finish-to-finish link computes a start by subtracting it.
    const estimate = Math.max(1, task.estimate ?? 1);
    const weeklyPoints = task.assigneeId
      ? weeklyPointsByAssignee.get(task.assigneeId)
      : undefined;
    const days =
      weeklyPoints && weeklyPoints > 0
        ? Math.max(1, Math.ceil((estimate / weeklyPoints) * 7))
        : estimate;

    let date = task.startDate && task.startDate > start ? task.startDate : start;
    const reasons: string[] = [];

    for (const edge of blockers.get(task.id) ?? []) {
      const blockerSpan = visit(byId.get(edge.dependsOnId)!, visiting);
      const earliest = earliestStart(edge, blockerSpan, days);
      // Only a blocker that actually pushes this task later is worth naming; a
      // link already satisfied by where the task sits explains nothing. (For a
      // plain FS edge this is exactly the old `end >= date` test, restated in
      // terms of the start the link implies.)
      if (earliest > date) {
        date = earliest;
        reasons.push(dependencyReason(edge.dependsOnId, edge));
      }
    }

    const lane = task.assigneeId ? lanes.get(task.assigneeId) : undefined;
    if (lane && lane >= date) {
      date = addDays(lane, 1);
      reasons.push("after assignee's planned work");
    }
    if (weeklyPoints && weeklyPoints > 0)
      reasons.push(
        `fits ${estimate} point${estimate === 1 ? "" : "s"} into ${weeklyPoints} points/week capacity`
      );

    const dueDate = addDays(date, days - 1);
    const span: Span = { start: date, end: dueDate };
    spans.set(task.id, span);
    if (task.assigneeId) lanes.set(task.assigneeId, dueDate);
    visiting.delete(task.id);

    out.push({
      taskId: task.id,
      startDate: date,
      dueDate,
      reasons: reasons.length ? reasons : ["next available schedule slot"],
    });
    return span;
  };

  for (const task of tasks) visit(task);
  return out.sort(
    (a, b) => a.startDate.localeCompare(b.startDate) || a.taskId - b.taskId
  );
}
