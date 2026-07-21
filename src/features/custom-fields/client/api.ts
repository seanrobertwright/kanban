import type {
  CreateCustomFieldInput,
  CustomField,
  CustomFieldValueInput,
  TaskCustomField,
  UpdateCustomFieldInput,
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

export async function fetchBoardFields(boardId: number): Promise<CustomField[]> {
  const res = await fetch(`/api/board/${boardId}/custom-fields`, {
    cache: "no-store",
  });
  return jsonOrThrow<CustomField[]>(res);
}

export function createField(
  boardId: number,
  input: CreateCustomFieldInput
): Promise<CustomField> {
  return fetch(`/api/board/${boardId}/custom-fields`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((res) => jsonOrThrow<CustomField>(res));
}

export function updateField(
  id: number,
  input: UpdateCustomFieldInput
): Promise<CustomField> {
  return fetch(`/api/custom-fields/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((res) => jsonOrThrow<CustomField>(res));
}

export async function deleteField(id: number): Promise<void> {
  const res = await fetch(`/api/custom-fields/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Delete failed (${res.status})`);
}

export async function fetchTaskFields(taskId: number): Promise<TaskCustomField[]> {
  const res = await fetch(`/api/tasks/${taskId}/custom-fields`, {
    cache: "no-store",
  });
  return jsonOrThrow<TaskCustomField[]>(res);
}

export function setTaskFields(
  taskId: number,
  values: CustomFieldValueInput[]
): Promise<TaskCustomField[]> {
  return fetch(`/api/tasks/${taskId}/custom-fields`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ values }),
  }).then((res) => jsonOrThrow<TaskCustomField[]>(res));
}
