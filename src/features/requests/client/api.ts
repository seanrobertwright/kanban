import type { RequestItem } from "../types";

export async function fetchRequests(boardId: number): Promise<RequestItem[]> {
  const res = await fetch(`/api/board/${boardId}/requests`, { cache: "no-store" });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(
      (body as { error?: string } | null)?.error ?? `Request failed (${res.status})`
    );
  }
  return res.json() as Promise<RequestItem[]>;
}
