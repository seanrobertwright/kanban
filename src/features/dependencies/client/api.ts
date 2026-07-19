import type { TaskDependencies } from "../types";

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(
      (body as { error?: string } | null)?.error ??
        `Request failed (${res.status})`
    );
  }
  return res.json() as Promise<T>;
}

/** A task's blockers and the tasks it could add as blockers, in one fetch. */
export function fetchDependencies(taskId: number): Promise<TaskDependencies> {
  return fetch(`/api/tasks/${taskId}/dependencies`, {
    cache: "no-store",
  }).then((res) => jsonOrThrow<TaskDependencies>(res));
}

/**
 * Add a blocker. Returns nothing (the section refetches the pair) but surfaces
 * the server's sentence on refusal — a cycle or a cross-board pick — which the
 * section shows verbatim.
 */
export async function addDependency(
  taskId: number,
  dependsOnId: number
): Promise<void> {
  const res = await fetch(`/api/tasks/${taskId}/dependencies`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dependsOnId }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(
      (body as { error?: string } | null)?.error ?? `Request failed (${res.status})`
    );
  }
}

export async function removeDependency(
  taskId: number,
  dependsOnId: number
): Promise<void> {
  const res = await fetch(
    `/api/tasks/${taskId}/dependencies/${dependsOnId}`,
    { method: "DELETE" }
  );
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(
      (body as { error?: string } | null)?.error ?? `Delete failed (${res.status})`
    );
  }
}
