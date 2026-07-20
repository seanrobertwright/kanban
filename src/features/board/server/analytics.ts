import type { Principal } from "@/features/auth/server/principal";
import { requireBoardRole } from "@/features/workspaces/server/authz";
import { query, queryOne } from "@/shared/db/client";
import type { BoardAnalytics, FlowStats } from "../types";

/**
 * Flow analytics for one board — lead time, cycle time, throughput, a
 * cumulative flow diagram, and current workload.
 *
 * Everything historical is *replayed from the activity log* rather than read
 * from state, because state cannot answer time questions: the task row says
 * where a card is, never when it got there. The log records every creation,
 * move, and deletion (the M1 criterion), so the board's whole history is a
 * fold over those rows — which is exactly what 003 promised a later milestone
 * and 020's comment ("cycle time") named.
 *
 * "Done" is the board's done column (020). A board that has not designated one
 * has no notion of completion, so lead/cycle/throughput come back null and the
 * UI says why, rather than inventing a definition the team did not choose.
 *
 * Subtask events are excluded (parentId in the snapshot): the pieces complete
 * with their parent, and counting them would double-book every decomposed
 * task's flow.
 */

interface FlowEvent {
  taskId: number;
  action: "task.created" | "task.moved" | "task.deleted";
  columnId: number | null;
  createdAt: string;
}

const DAY_MS = 86_400_000;

/** A day window longer than this is clamped — a burndown series is bounded. */
const MAX_BURNDOWN_DAYS = 92;

/** Midnight (UTC) of a 'YYYY-MM-DD' date string, in ms. */
function dayStartMs(date: string): number {
  return Date.parse(`${date}T00:00:00.000Z`);
}

/**
 * The active sprint's burndown — remaining committed points at each day's end
 * over its window, replayed from the activity log the same way the CFD is, and
 * for the same reason: "how much work was left on Tuesday" is a time question
 * state cannot answer.
 *
 * The fold tracks each top-level task's (sprintId, columnId, estimate) — every
 * task.* row carries a full snapshot — and a task counts toward "remaining"
 * only while it is in THIS sprint and not in the done column. A running total
 * is nudged by each event's delta rather than re-summed per day, so the cost is
 * one pass over the events plus one sample per day.
 *
 * Days past today carry null: the actual line stops at now, while the client
 * draws the ideal line (committed → 0) across the whole window.
 */
async function computeBurndown(
  boardId: number,
  doneColumnId: number | null
): Promise<BoardAnalytics["burndown"]> {
  const sprint = await queryOne<{
    id: number;
    name: string;
    startDate: string | null;
    endDate: string | null;
  }>(
    `SELECT id, name, start_date AS "startDate", end_date AS "endDate"
       FROM sprint WHERE board_id = $1 AND status = 'active'`,
    [boardId]
  );
  if (!sprint) return null;

  const now = Date.now();
  const todayStart = new Date(now);
  todayStart.setUTCHours(0, 0, 0, 0);
  const startMs = sprint.startDate
    ? dayStartMs(sprint.startDate)
    : todayStart.getTime();
  // The ideal line ends at the planned end (or today, if unset); the actual
  // line must still reach today when a sprint overruns, so the window runs to
  // whichever is later, clamped so a mis-set year cannot explode the series.
  const plannedEndMs = sprint.endDate
    ? dayStartMs(sprint.endDate)
    : todayStart.getTime();
  const idealEndMs = Math.max(plannedEndMs, startMs);
  let lastMs = Math.max(idealEndMs, todayStart.getTime());
  const span = Math.round((lastMs - startMs) / DAY_MS);
  if (span > MAX_BURNDOWN_DAYS) lastMs = startMs + MAX_BURNDOWN_DAYS * DAY_MS;

  // Every top-level task event on the board, oldest first — task.updated is in
  // the set (unlike the flow fold) because a sprint or estimate change rides
  // that action. Missing sprintId/estimate (pre-028/pre-022 rows) read as
  // backlog / unestimated, which is what they were.
  const events = await query<{
    taskId: number;
    action: string;
    columnId: number | null;
    sprintId: number | null;
    estimate: number | null;
    createdAt: string;
  }>(
    `SELECT al.task_id AS "taskId", al.action,
            COALESCE((al.after->>'columnId')::int,
                     (al.before->>'columnId')::int) AS "columnId",
            (al.after->>'sprintId')::int AS "sprintId",
            (al.after->>'estimate')::int AS estimate,
            al.created_at AS "createdAt"
       FROM activity_log al
      WHERE al.board_id = $1
        AND al.action IN ('task.created', 'task.updated', 'task.moved', 'task.deleted')
        AND COALESCE(al.after->>'parentId', al.before->>'parentId') IS NULL
      ORDER BY al.id`,
    [boardId]
  );

  const state = new Map<number, number>(); // taskId → its current contribution
  let remaining = 0;
  const contribution = (
    sprintId: number | null,
    columnId: number | null,
    estimate: number | null
  ): number =>
    sprintId === sprint.id && columnId !== doneColumnId ? estimate ?? 0 : 0;

  let cursor = 0;
  const applyThrough = (untilMs: number) => {
    while (cursor < events.length) {
      const e = events[cursor];
      if (Date.parse(e.createdAt) > untilMs) break;
      cursor += 1;
      const prev = state.get(e.taskId) ?? 0;
      if (e.action === "task.deleted") {
        remaining -= prev;
        state.delete(e.taskId);
        continue;
      }
      const next = contribution(e.sprintId, e.columnId, e.estimate);
      remaining += next - prev;
      state.set(e.taskId, next);
    }
  };

  const days: { date: string; remaining: number | null }[] = [];
  let committed = 0;
  const todayEnd = todayStart.getTime() + DAY_MS - 1;
  for (let ms = startMs; ms <= lastMs; ms += DAY_MS) {
    const endOfDay = ms + DAY_MS - 1;
    if (endOfDay <= todayEnd) {
      applyThrough(endOfDay);
      if (ms === startMs) committed = remaining;
      days.push({ date: new Date(ms).toISOString().slice(0, 10), remaining });
    } else {
      days.push({ date: new Date(ms).toISOString().slice(0, 10), remaining: null });
    }
  }

  return {
    sprintId: sprint.id,
    name: sprint.name,
    startDate: new Date(startMs).toISOString().slice(0, 10),
    endDate: new Date(idealEndMs).toISOString().slice(0, 10),
    committed,
    days,
  };
}

function stats(days: number[]): FlowStats {
  const sorted = [...days].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return {
    count: sorted.length,
    avgDays:
      Math.round((sorted.reduce((s, d) => s + d, 0) / sorted.length) * 10) / 10,
    medianDays:
      Math.round(
        (sorted.length % 2
          ? sorted[mid]
          : (sorted[mid - 1] + sorted[mid]) / 2) * 10
      ) / 10,
  };
}

export async function getBoardAnalytics(
  actor: string | Principal,
  boardId: number
): Promise<BoardAnalytics> {
  await requireBoardRole(actor, boardId, "viewer");

  const board = await queryOne<{ doneColumnId: number | null }>(
    `SELECT done_column_id AS "doneColumnId" FROM board WHERE id = $1`,
    [boardId]
  );
  const doneColumnId = board?.doneColumnId ?? null;

  // The board's flow events, oldest first. columnId is wherever the task
  // landed (after) or was (before, for deletions); the parentId filter keeps
  // subtask flow out. Timestamps come back as ISO strings via the pool's
  // parsers.
  const events = await query<FlowEvent>(
    `SELECT al.task_id AS "taskId", al.action,
            COALESCE((al.after->>'columnId')::int,
                     (al.before->>'columnId')::int) AS "columnId",
            al.created_at AS "createdAt"
       FROM activity_log al
      WHERE al.board_id = $1
        AND al.action IN ('task.created', 'task.moved', 'task.deleted')
        AND COALESCE(al.after->>'parentId', al.before->>'parentId') IS NULL
      ORDER BY al.id`,
    [boardId]
  );

  // One fold, several answers: where every task sits (CFD), when it was
  // created, when it first moved (cycle start), when it entered Done.
  const inColumn = new Map<number, number>();
  const createdAt = new Map<number, number>();
  const firstMovedAt = new Map<number, number>();
  const completedAt = new Map<number, number>();

  const today = new Date();
  today.setUTCHours(23, 59, 59, 999);
  const windowStart = today.getTime() - 29 * DAY_MS;
  const cfd: { date: string; counts: Record<number, number> }[] = [];

  let cursor = 0;
  const applyThrough = (untilMs: number) => {
    while (cursor < events.length) {
      const e = events[cursor];
      const t = Date.parse(e.createdAt);
      if (t > untilMs) break;
      cursor += 1;
      if (e.action === "task.created" && e.columnId !== null) {
        inColumn.set(e.taskId, e.columnId);
        createdAt.set(e.taskId, t);
        if (e.columnId === doneColumnId) completedAt.set(e.taskId, t);
      } else if (e.action === "task.moved" && e.columnId !== null) {
        inColumn.set(e.taskId, e.columnId);
        if (!firstMovedAt.has(e.taskId)) firstMovedAt.set(e.taskId, t);
        if (e.columnId === doneColumnId) {
          if (!completedAt.has(e.taskId)) completedAt.set(e.taskId, t);
        } else {
          // Left Done: it is no longer complete, and a later arrival restamps.
          completedAt.delete(e.taskId);
        }
      } else if (e.action === "task.deleted") {
        inColumn.delete(e.taskId);
      }
    }
  };

  for (let day = 0; day < 30; day++) {
    const endOfDay = windowStart + day * DAY_MS;
    applyThrough(endOfDay);
    const counts: Record<number, number> = {};
    for (const columnId of inColumn.values()) {
      counts[columnId] = (counts[columnId] ?? 0) + 1;
    }
    cfd.push({ date: new Date(endOfDay).toISOString().slice(0, 10), counts });
  }
  applyThrough(Number.MAX_SAFE_INTEGER);

  let leadTime: FlowStats | null = null;
  let cycleTime: FlowStats | null = null;
  let throughput: { weekStart: string; count: number }[] | null = null;

  if (doneColumnId !== null) {
    const leads: number[] = [];
    const cycles: number[] = [];
    for (const [taskId, doneMs] of completedAt) {
      const born = createdAt.get(taskId);
      if (born === undefined) continue; // Created before the board? Log says no.
      leads.push((doneMs - born) / DAY_MS);
      cycles.push((doneMs - (firstMovedAt.get(taskId) ?? born)) / DAY_MS);
    }
    leadTime = leads.length ? stats(leads) : { count: 0, avgDays: 0, medianDays: 0 };
    cycleTime = cycles.length
      ? stats(cycles)
      : { count: 0, avgDays: 0, medianDays: 0 };

    // Eight ISO-ish weeks (Monday-anchored), oldest first.
    const weeks: { weekStart: string; count: number }[] = [];
    const monday = new Date();
    monday.setUTCHours(0, 0, 0, 0);
    monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
    for (let w = 7; w >= 0; w--) {
      const start = monday.getTime() - w * 7 * DAY_MS;
      const end = start + 7 * DAY_MS;
      let count = 0;
      for (const doneMs of completedAt.values()) {
        if (doneMs >= start && doneMs < end) count += 1;
      }
      weeks.push({
        weekStart: new Date(start).toISOString().slice(0, 10),
        count,
      });
    }
    throughput = weeks;
  }

  // Workload reads current state, not the log — "who holds how much right
  // now" is exactly the question state answers. Top-level only, subtasks'
  // reasoning again.
  const workload = await query<BoardAnalytics["workload"][number]>(
    `SELECT CASE WHEN t.assignee_id IS NOT NULL THEN 'human'
                 WHEN t.agent_id IS NOT NULL THEN 'agent'
                 ELSE NULL END AS "assigneeType",
            COALESCE(t.assignee_id, t.agent_id) AS "assigneeId",
            COUNT(*)::int AS count,
            COALESCE(SUM(t.estimate), 0)::int AS points
       FROM task t
       JOIN board_column bc ON bc.id = t.column_id
      WHERE bc.board_id = $1 AND t.parent_id IS NULL
      GROUP BY 1, 2
      ORDER BY count DESC`,
    [boardId]
  );

  // Velocity: completed points per finished sprint, oldest first. Reads the
  // sprint's frozen scope — completing rolled its unfinished work out, so
  // donePoints IS the sprint's velocity — the same PROGRESS_COLUMNS shape the
  // sprint repository uses, restricted to done tasks.
  const velocity = await query<BoardAnalytics["velocity"][number]>(
    `SELECT s.id AS "sprintId", s.name,
            (SELECT COALESCE(SUM(t.estimate), 0)::int
               FROM task t
              WHERE t.sprint_id = s.id AND t.parent_id IS NULL
                AND $2::int IS NOT NULL AND t.column_id = $2::int) AS points
       FROM sprint s
      WHERE s.board_id = $1 AND s.status = 'completed'
      ORDER BY s.end_date NULLS LAST, s.id`,
    [boardId, doneColumnId]
  );

  const burndown = await computeBurndown(boardId, doneColumnId);

  return { leadTime, cycleTime, throughput, cfd, workload, velocity, burndown };
}
