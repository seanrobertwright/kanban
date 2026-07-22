import type {
  CreateSlaPolicyInput,
  SlaPolicy,
  TaskSlaStatus,
  UpdateSlaPolicyInput,
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

export async function fetchSlaPolicies(boardId: number): Promise<SlaPolicy[]> {
  const res = await fetch(`/api/board/${boardId}/sla`, { cache: "no-store" });
  return jsonOrThrow<SlaPolicy[]>(res);
}

export function createSlaPolicy(
  boardId: number,
  input: CreateSlaPolicyInput
): Promise<SlaPolicy> {
  return fetch(`/api/board/${boardId}/sla`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((res) => jsonOrThrow<SlaPolicy>(res));
}

export function updateSlaPolicy(
  id: number,
  input: UpdateSlaPolicyInput
): Promise<SlaPolicy> {
  return fetch(`/api/sla/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((res) => jsonOrThrow<SlaPolicy>(res));
}

export async function deleteSlaPolicy(id: number): Promise<void> {
  const res = await fetch(`/api/sla/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Delete failed (${res.status})`);
}

export async function fetchTaskSla(taskId: number): Promise<TaskSlaStatus[]> {
  const res = await fetch(`/api/tasks/${taskId}/sla`, { cache: "no-store" });
  return jsonOrThrow<TaskSlaStatus[]>(res);
}
