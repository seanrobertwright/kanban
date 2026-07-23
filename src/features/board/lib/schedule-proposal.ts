import { addDays } from "./schedule";

export interface SchedulableTask { id: number; title: string; estimate: number | null; startDate: string | null; dueDate: string | null; assigneeId: string | null; }
export interface ScheduleProposal { taskId: number; startDate: string; dueDate: string; reasons: string[]; }

/** Deterministic proposal only: dependencies win, then each assignee is sequenced. */
export function proposeSchedule(tasks: SchedulableTask[], edges: { taskId: number; dependsOnId: number }[], start = new Date().toISOString().slice(0, 10)): ScheduleProposal[] {
  const byId = new Map(tasks.map(t => [t.id, t]));
  const blockers = new Map<number, number[]>();
  for (const edge of edges) if (byId.has(edge.taskId) && byId.has(edge.dependsOnId)) (blockers.get(edge.taskId) ?? blockers.set(edge.taskId, []).get(edge.taskId)!).push(edge.dependsOnId);
  const ends = new Map<number, string>(); const lanes = new Map<string, string>(); const out: ScheduleProposal[] = [];
  const visit = (task: SchedulableTask, visiting = new Set<number>()) => {
    if (ends.has(task.id) || visiting.has(task.id)) return ends.get(task.id) ?? start;
    visiting.add(task.id); let date = task.startDate && task.startDate > start ? task.startDate : start; const reasons: string[] = [];
    for (const id of blockers.get(task.id) ?? []) { const end = visit(byId.get(id)!, visiting); if (end >= date) { date = addDays(end, 1); reasons.push(`after dependency #${id}`); } }
    const lane = task.assigneeId ? lanes.get(task.assigneeId) : undefined; if (lane && lane >= date) { date = addDays(lane, 1); reasons.push("after assignee's planned work"); }
    const days = Math.max(1, task.estimate ?? 1); const dueDate = addDays(date, days - 1); ends.set(task.id, dueDate); if (task.assigneeId) lanes.set(task.assigneeId, dueDate); visiting.delete(task.id);
    out.push({ taskId: task.id, startDate: date, dueDate, reasons: reasons.length ? reasons : ["next available schedule slot"] }); return dueDate;
  };
  for (const task of tasks) visit(task); return out.sort((a,b) => a.startDate.localeCompare(b.startDate) || a.taskId-b.taskId);
}
