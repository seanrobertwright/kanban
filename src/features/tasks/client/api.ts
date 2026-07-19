import type { Actor } from "@/features/activity/types";
import type {
  CreateTaskInput,
  MoveTaskInput,
  Task,
  TaskPriority,
  UpdateTaskInput,
} from "../types";

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(
      (body as { error?: string } | null)?.error ?? `Request failed (${res.status})`
    );
  }
  return res.json() as Promise<T>;
}

export function createTask(input: CreateTaskInput): Promise<Task> {
  return fetch("/api/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((res) => jsonOrThrow<Task>(res));
}

export function updateTask(id: number, input: UpdateTaskInput): Promise<Task> {
  return fetch(`/api/tasks/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((res) => jsonOrThrow<Task>(res));
}

export function moveTask(id: number, input: MoveTaskInput): Promise<Task> {
  return fetch(`/api/tasks/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((res) => jsonOrThrow<Task>(res));
}

export interface BulkResult {
  updated: number;
  failed: { id: number; error: string }[];
}

/**
 * Edit or delete many tasks in one request — the list view's bulk bar. The
 * server loops the per-task mutations so each keeps its own authz and log
 * rows; partial failure comes back in the result rather than as a thrown
 * error, because eleven successes should not be reported as a failure.
 */
export function bulkTasks(
  ids: number[],
  action:
    | { delete: true }
    | {
        columnId?: number;
        assignee?: Actor | null;
        priority?: TaskPriority;
        dueDate?: string | null;
      }
): Promise<BulkResult> {
  return fetch("/api/tasks/bulk", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids, ...action }),
  }).then((res) => jsonOrThrow<BulkResult>(res));
}

export async function deleteTask(id: number): Promise<void> {
  const res = await fetch(`/api/tasks/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Delete failed (${res.status})`);
}

/**
 * A task's subtasks. Fetched when a dialog opens rather than ridden along on the
 * board, which is the shape fetchTaskComments already set: the card needs a
 * count, and the pieces are rows nobody is looking at until they open one.
 *
 * There is no createSubtask beside it — a subtask is a task, so createTask with a
 * parentId is how one is made.
 */
export async function fetchSubtasks(taskId: number): Promise<Task[]> {
  const res = await fetch(`/api/tasks/${taskId}/subtasks`, {
    cache: "no-store",
  });
  return jsonOrThrow<Task[]>(res);
}
