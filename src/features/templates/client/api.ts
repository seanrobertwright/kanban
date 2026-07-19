import type {
  CreateTemplateInput,
  TaskTemplate,
  UpdateTemplateInput,
} from "../types";

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

export function fetchTemplates(workspaceId: string): Promise<TaskTemplate[]> {
  return fetch(`/api/workspaces/${workspaceId}/templates`).then((res) =>
    jsonOrThrow<TaskTemplate[]>(res)
  );
}

export function createTemplate(
  workspaceId: string,
  input: CreateTemplateInput
): Promise<TaskTemplate> {
  return fetch(`/api/workspaces/${workspaceId}/templates`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((res) => jsonOrThrow<TaskTemplate>(res));
}

export function updateTemplate(
  id: number,
  input: UpdateTemplateInput
): Promise<TaskTemplate> {
  return fetch(`/api/templates/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((res) => jsonOrThrow<TaskTemplate>(res));
}

export async function deleteTemplate(id: number): Promise<void> {
  const res = await fetch(`/api/templates/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(
      (body as { error?: string } | null)?.error ?? `Delete failed (${res.status})`
    );
  }
}
