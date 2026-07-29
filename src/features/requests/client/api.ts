import type { RequestItem, TriageRequestInput } from "../types";

export async function fetchRequests(boardId: number): Promise<RequestItem[]> {
  const res = await fetch(`/api/board/${boardId}/requests`, { cache: "no-store" });
  return read<RequestItem[]>(res);
}

/** Accept, decline, or reopen one request; returns the request as it now reads. */
export async function triageRequest(
  boardId: number,
  taskId: number,
  input: TriageRequestInput
): Promise<RequestItem> {
  const res = await fetch(`/api/board/${boardId}/requests/${taskId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return read<RequestItem>(res);
}

async function read<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(
      (body as { error?: string } | null)?.error ?? `Request failed (${res.status})`
    );
  }
  return res.json() as Promise<T>;
}
