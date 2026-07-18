import type { CreateSavedViewInput, SavedView } from "../types";

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(
      (body as { error?: string } | null)?.error ?? `Request failed (${res.status})`
    );
  }
  return res.json() as Promise<T>;
}

export function fetchSavedViews(workspaceId: string): Promise<SavedView[]> {
  return fetch(`/api/workspaces/${workspaceId}/views`).then((res) =>
    jsonOrThrow<SavedView[]>(res)
  );
}

export function createSavedView(
  workspaceId: string,
  input: CreateSavedViewInput
): Promise<SavedView> {
  return fetch(`/api/workspaces/${workspaceId}/views`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((res) => jsonOrThrow<SavedView>(res));
}

export async function deleteSavedView(id: number): Promise<void> {
  const res = await fetch(`/api/views/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(
      (body as { error?: string } | null)?.error ?? `Delete failed (${res.status})`
    );
  }
}
