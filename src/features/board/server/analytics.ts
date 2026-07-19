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

  return { leadTime, cycleTime, throughput, cfd, workload };
}
