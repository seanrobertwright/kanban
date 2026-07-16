import type { CreateLabelInput, Label, UpdateLabelInput } from "../types";

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(
      (body as { error?: string } | null)?.error ?? `Request failed (${res.status})`
    );
  }
  return res.json() as Promise<T>;
}

export function fetchLabels(workspaceId: string): Promise<Label[]> {
  return fetch(`/api/workspaces/${workspaceId}/labels`).then((res) =>
    jsonOrThrow<Label[]>(res)
  );
}

export function createLabel(
  workspaceId: string,
  input: CreateLabelInput
): Promise<Label> {
  return fetch(`/api/workspaces/${workspaceId}/labels`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((res) => jsonOrThrow<Label>(res));
}

export function updateLabel(id: number, input: UpdateLabelInput): Promise<Label> {
  return fetch(`/api/labels/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((res) => jsonOrThrow<Label>(res));
}

export async function deleteLabel(id: number): Promise<void> {
  const res = await fetch(`/api/labels/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(
      (body as { error?: string } | null)?.error ?? `Delete failed (${res.status})`
    );
  }
}
