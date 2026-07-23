import type { CustomField } from "@/features/custom-fields/types";
import type { TaskDependencyEdge } from "@/features/dependencies/types";
import type { Milestone } from "@/features/milestones/types";
import type { Objective } from "@/features/objectives/types";
import type { Epic } from "@/features/epics/types";
import type { Sprint } from "@/features/sprints/types";
import type { Task } from "@/features/tasks/types";
import type { Board } from "@/features/workspaces/types";

export interface Column {
  id: number;
  boardId: number;
  title: string;
  position: number;
  /**
   * How many tasks this column should hold at once (023), or null for no
   * limit. Advice made visible, not a wall: the board renders the count
   * against it and turns loud when over, but a move is never refused — a WIP
   * limit exists to start a conversation about flow, not to teach people to
   * raise the limit.
   */
  wipLimit: number | null;
}

/** Days-based summary of a set of completed tasks (analytics). */
export interface FlowStats {
  count: number;
  avgDays: number;
  medianDays: number;
}

/**
 * Flow analytics for one board — the shape server/analytics.ts computes by
 * replaying the activity log. Here rather than beside the computation so the
 * client can name it without a server import.
 */
export interface BoardAnalytics {
  /** Explainable, deterministic delivery-risk signals for open top-level work. */
  risks: import("./lib/risk").TaskRisk[];
  /** Created → done, per completed task. Null when no done column is set. */
  leadTime: FlowStats | null;
  /** First move → done — time in motion, not time in the backlog. */
  cycleTime: FlowStats | null;
  /** Completions per week, oldest first, last 8 weeks. */
  throughput: { weekStart: string; count: number }[] | null;
  /** Tasks per column at each day's end, last 30 days, oldest first. */
  cfd: { date: string; counts: Record<number, number> }[];
  /** Current top-level tasks per assignee, with their points. */
  workload: {
    assigneeType: "human" | "agent" | null;
    assigneeId: string | null;
    count: number;
    points: number;
  }[];
  /**
   * Points completed per finished sprint (028/M4), oldest first — the board's
   * velocity history. `points` is the sprint's frozen donePoints: completing a
   * sprint rolls its unfinished work out of scope, so what remains in a
   * completed sprint is exactly what got done. Empty until a sprint completes.
   */
  velocity: { sprintId: number; name: string; points: number }[];
  /**
   * The active sprint's burndown, or null when no sprint is running. `days` is
   * the remaining committed points at each day's end across the sprint window,
   * replayed from the activity log; a day not yet reached carries null so the
   * actual line stops at today while the ideal line (committed → 0) spans the
   * whole window.
   */
  burndown: {
    sprintId: number;
    name: string;
    startDate: string;
    endDate: string;
    committed: number;
    days: { date: string; remaining: number | null }[];
  } | null;
}

export interface BoardData {
  board: Board;
  columns: Column[];
  tasks: Task[];
  /**
   * The column that completes a task on this board (020), or null if none is
   * designated. A recurring task moved into it spawns its successor. On BoardData
   * rather than Board so the shared Board type — and its other producers — stay
   * untouched; it is a board fact this one read needs, not one every Board carries.
   */
  doneColumnId: number | null;
  /**
   * The board's milestones (026), progress included — on BoardData for
   * doneColumnId's reason: the task dialog's picker and the milestones dialog
   * both read them, and a board fact one read needs should ride that read.
   */
  milestones: Milestone[];
  /**
   * The board's epics (031), progress included — on BoardData for the milestone
   * reason: the task dialog's epic picker and the EpicsDialog both read them.
   */
  epics: Epic[];
  /**
   * The board's sprints (028), progress included — on BoardData for the
   * milestone reason: the task dialog's sprint picker reads them, and the
   * SprintsDialog (which also fetches its own fresh copy with capacity) opens
   * against them. Ordered active → planning → completed.
   */
  sprints: Sprint[];
  /**
   * Every blocked-by edge among the board's tasks (036) — on BoardData for the
   * milestone reason, but read board-wide rather than per task: the Gantt draws
   * dependency arrows and the critical path across all bars at once, which needs
   * the whole edge set in one read. A single task's blockers are still fetched
   * on demand when its dialog opens (getDependencies); this is the board-scale
   * view of the same table.
   */
  dependencies: TaskDependencyEdge[];
  /**
   * The board's custom-field definitions (035 → 036 follow-up), in display
   * order — on BoardData for the milestone reason: a card and a list cell resolve
   * a task's answer (which carries only {fieldId, value}) to a name and type
   * through this list, the way a label chip resolves its colour. The manager
   * dialog and the task dialog's section fetch their own copies; this is the
   * board read's copy for the surfaces that render values.
   */
  customFields: CustomField[];
  /**
   * The board's objectives (037), key results and progress included — on
   * BoardData for the milestone reason: the task dialog's objective picker reads
   * them, and the ObjectivesDialog opens against them. Ordered by due date, then
   * name.
   */
  objectives: Objective[];
}
