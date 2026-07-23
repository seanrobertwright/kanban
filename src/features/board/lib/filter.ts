/**
 * The board filter — pure, dependency-free, and importable from anywhere
 * (client board bar or server report code). It was extracted from
 * `components/board-filter-bar.tsx` (which now re-exports it) so the reports
 * feature (5.1) can reuse the *exact same* predicate the saved views (015) store
 * — one source of truth for "does this task match this filter".
 *
 * Within a facet the selected values are OR'd (any chosen priority matches);
 * across facets they are AND'd. The assignee facet carries the sentinel
 * "unassigned" so "has no assignee" is a value you can pick.
 */
import type { Actor } from "@/features/activity/types";
import type { Task } from "@/features/tasks/types";
import type { TaskPriority } from "@/features/tasks/types";

export interface BoardFilter {
  text: string;
  priorities: TaskPriority[];
  labelIds: number[];
  /** Actor keys — `human:<id>` / `agent:<id>` — plus the literal "unassigned". */
  assignees: string[];
}

export const EMPTY_FILTER: BoardFilter = {
  text: "",
  priorities: [],
  labelIds: [],
  assignees: [],
};

export function isFilterActive(f: BoardFilter): boolean {
  return (
    f.text.trim() !== "" ||
    f.priorities.length > 0 ||
    f.labelIds.length > 0 ||
    f.assignees.length > 0
  );
}

/** `human:<id>` / `agent:<id>`, or "unassigned" — the assignee facet's key. */
export function actorKey(a: Actor | null): string {
  return a ? `${a.type}:${a.id}` : "unassigned";
}

/**
 * Whether a task survives the filter. Cheap and pure so it can run over every
 * task on every keystroke without a fetch.
 */
export function taskMatchesFilter(task: Task, f: BoardFilter): boolean {
  const q = f.text.trim().toLowerCase();
  if (
    q &&
    !task.title.toLowerCase().includes(q) &&
    !task.description.toLowerCase().includes(q)
  ) {
    return false;
  }
  if (f.priorities.length > 0 && !f.priorities.includes(task.priority)) {
    return false;
  }
  if (f.labelIds.length > 0) {
    const worn = new Set(task.labels.map((l) => l.id));
    if (!f.labelIds.some((id) => worn.has(id))) return false;
  }
  if (f.assignees.length > 0 && !f.assignees.includes(actorKey(task.assignee))) {
    return false;
  }
  return true;
}
