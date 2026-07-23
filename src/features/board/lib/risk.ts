export type RiskLevel = "low" | "medium" | "high";

export interface RiskInput {
  id: number;
  title: string;
  dueDate: string | null;
  blockedByCount: number;
  ageDays: number;
  inDoneColumn: boolean;
}

export interface TaskRisk {
  taskId: number;
  title: string;
  score: number;
  level: RiskLevel;
  reasons: string[];
}

/**
 * Deterministic delivery-risk signal. It intentionally uses only explainable
 * board facts: a late date, a declared blocker, and work aging in place. An
 * optional agent may narrate these facts later, but never supplies the score.
 */
export function assessRisk(tasks: RiskInput[], today = new Date().toISOString().slice(0, 10)): TaskRisk[] {
  return tasks
    .filter((task) => !task.inDoneColumn)
    .map((task) => {
      let score = 0;
      const reasons: string[] = [];
      if (task.dueDate && task.dueDate < today) {
        score += 0.5;
        reasons.push(`overdue since ${task.dueDate}`);
      }
      if (task.blockedByCount > 0) {
        score += Math.min(0.35, task.blockedByCount * 0.2);
        reasons.push(`blocked by ${task.blockedByCount} task${task.blockedByCount === 1 ? "" : "s"}`);
      }
      if (task.ageDays >= 14) {
        score += 0.2;
        reasons.push(`open for ${Math.floor(task.ageDays)} days`);
      } else if (task.ageDays >= 7) {
        score += 0.1;
        reasons.push(`open for ${Math.floor(task.ageDays)} days`);
      }
      score = Math.min(1, Math.round(score * 100) / 100);
      const level: RiskLevel = score >= 0.6 ? "high" : score >= 0.25 ? "medium" : "low";
      return { taskId: task.id, title: task.title, score, level, reasons };
    })
    .filter((risk) => risk.score > 0)
    .sort((a, b) => b.score - a.score || a.taskId - b.taskId);
}
