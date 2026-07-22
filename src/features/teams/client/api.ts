import type {
  CreateTeamInput,
  ScaledAgileOverview,
  Team,
  UpdateTeamInput,
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

export function fetchScaledAgile(
  workspaceId: string
): Promise<ScaledAgileOverview> {
  return fetch(`/api/workspaces/${workspaceId}/scaled-agile`, {
    cache: "no-store",
  }).then((res) => jsonOrThrow<ScaledAgileOverview>(res));
}

export function createTeam(
  workspaceId: string,
  input: CreateTeamInput
): Promise<Team> {
  return fetch(`/api/workspaces/${workspaceId}/teams`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((res) => jsonOrThrow<Team>(res));
}

export function updateTeam(id: number, input: UpdateTeamInput): Promise<Team> {
  return fetch(`/api/teams/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((res) => jsonOrThrow<Team>(res));
}

export async function deleteTeam(id: number): Promise<void> {
  const res = await fetch(`/api/teams/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Delete failed (${res.status})`);
}

export async function addTeamMember(
  teamId: number,
  userId: string
): Promise<void> {
  const res = await fetch(`/api/teams/${teamId}/members`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId }),
  });
  if (!res.ok) throw new Error(`Add failed (${res.status})`);
}

export async function removeTeamMember(
  teamId: number,
  userId: string
): Promise<void> {
  const res = await fetch(`/api/teams/${teamId}/members`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId }),
  });
  if (!res.ok) throw new Error(`Remove failed (${res.status})`);
}

export async function assignBoardTeam(
  boardId: number,
  teamId: number | null
): Promise<void> {
  const res = await fetch(`/api/board/${boardId}/team`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ teamId }),
  });
  if (!res.ok) throw new Error(`Assign failed (${res.status})`);
}
