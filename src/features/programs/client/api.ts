import type {
  CreateProgramInput,
  Program,
  ProgramsOverview,
  UpdateProgramInput,
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

export async function fetchPrograms(
  workspaceId: string
): Promise<ProgramsOverview> {
  const res = await fetch(`/api/workspaces/${workspaceId}/programs`, {
    cache: "no-store",
  });
  return jsonOrThrow<ProgramsOverview>(res);
}

export function createProgram(
  workspaceId: string,
  input: CreateProgramInput
): Promise<Program> {
  return fetch(`/api/workspaces/${workspaceId}/programs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((res) => jsonOrThrow<Program>(res));
}

export function updateProgram(
  id: number,
  input: UpdateProgramInput
): Promise<Program> {
  return fetch(`/api/programs/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((res) => jsonOrThrow<Program>(res));
}

export async function deleteProgram(id: number): Promise<void> {
  const res = await fetch(`/api/programs/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Delete failed (${res.status})`);
}

export async function assignBoardProgram(
  boardId: number,
  programId: number | null
): Promise<void> {
  const res = await fetch(`/api/board/${boardId}/program`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ programId }),
  });
  if (!res.ok) throw new Error(`Assign failed (${res.status})`);
}
