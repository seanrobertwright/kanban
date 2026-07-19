import type {
  ChecklistItem,
  CreateChecklistItemInput,
  UpdateChecklistItemInput,
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

export function fetchChecklist(taskId: number): Promise<ChecklistItem[]> {
  return fetch(`/api/tasks/${taskId}/checklist`, { cache: "no-store" }).then(
    (res) => jsonOrThrow<ChecklistItem[]>(res)
  );
}

export function createChecklistItem(
  taskId: number,
  input: CreateChecklistItemInput
): Promise<ChecklistItem> {
  return fetch(`/api/tasks/${taskId}/checklist`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((res) => jsonOrThrow<ChecklistItem>(res));
}

export function updateChecklistItem(
  id: number,
  input: UpdateChecklistItemInput
): Promise<ChecklistItem> {
  return fetch(`/api/checklist/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((res) => jsonOrThrow<ChecklistItem>(res));
}

export async function deleteChecklistItem(id: number): Promise<void> {
  const res = await fetch(`/api/checklist/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(
      (body as { error?: string } | null)?.error ?? `Delete failed (${res.status})`
    );
  }
}
