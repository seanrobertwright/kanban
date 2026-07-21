import type {
  CreateKeyResultInput,
  CreateObjectiveInput,
  Objective,
  UpdateKeyResultInput,
  UpdateObjectiveInput,
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

export async function fetchObjectives(boardId: number): Promise<Objective[]> {
  const res = await fetch(`/api/board/${boardId}/objectives`, {
    cache: "no-store",
  });
  return jsonOrThrow<Objective[]>(res);
}

export function createObjective(
  boardId: number,
  input: CreateObjectiveInput
): Promise<Objective> {
  return fetch(`/api/board/${boardId}/objectives`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((res) => jsonOrThrow<Objective>(res));
}

export function updateObjective(
  id: number,
  input: UpdateObjectiveInput
): Promise<Objective> {
  return fetch(`/api/objectives/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((res) => jsonOrThrow<Objective>(res));
}

export async function deleteObjective(id: number): Promise<void> {
  const res = await fetch(`/api/objectives/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Delete failed (${res.status})`);
}

export function createKeyResult(
  objectiveId: number,
  input: CreateKeyResultInput
): Promise<Objective> {
  return fetch(`/api/objectives/${objectiveId}/key-results`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((res) => jsonOrThrow<Objective>(res));
}

export function updateKeyResult(
  id: number,
  input: UpdateKeyResultInput
): Promise<Objective> {
  return fetch(`/api/key-results/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((res) => jsonOrThrow<Objective>(res));
}

export function deleteKeyResult(id: number): Promise<Objective> {
  return fetch(`/api/key-results/${id}`, { method: "DELETE" }).then((res) =>
    jsonOrThrow<Objective>(res)
  );
}
