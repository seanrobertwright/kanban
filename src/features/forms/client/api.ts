import type { Task } from "@/features/tasks/types";
import type {
  CreateFormInput,
  Form,
  SubmitFormInput,
  UpdateFormInput,
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

export async function fetchForms(boardId: number): Promise<Form[]> {
  const res = await fetch(`/api/board/${boardId}/forms`, { cache: "no-store" });
  return jsonOrThrow<Form[]>(res);
}

export function createForm(
  boardId: number,
  input: CreateFormInput
): Promise<Form> {
  return fetch(`/api/board/${boardId}/forms`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((res) => jsonOrThrow<Form>(res));
}

export function updateForm(id: number, input: UpdateFormInput): Promise<Form> {
  return fetch(`/api/forms/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((res) => jsonOrThrow<Form>(res));
}

export async function deleteForm(id: number): Promise<void> {
  const res = await fetch(`/api/forms/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Delete failed (${res.status})`);
}

export function submitForm(
  id: number,
  input: SubmitFormInput
): Promise<Task> {
  return fetch(`/api/forms/${id}/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((res) => jsonOrThrow<Task>(res));
}
