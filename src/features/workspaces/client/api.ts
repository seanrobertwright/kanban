import type {
  Board,
  Invitation,
  Member,
  NewWorkspace,
  WorkspaceRole,
} from "../types";

export interface MembersResponse {
  members: Member[];
  /** Always empty for non-admins — the server withholds pending emails. */
  invitations: Invitation[];
}

/** Surfaces the server's message, which carries the reason (last owner, etc.). */
async function unwrap<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `Request failed (${res.status})`);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

export async function createWorkspace(name: string): Promise<NewWorkspace> {
  return unwrap(
    await fetch("/api/workspaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    })
  );
}

export async function createBoard(
  workspaceId: string,
  name: string
): Promise<Board> {
  return unwrap(
    await fetch(`/api/workspaces/${workspaceId}/boards`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    })
  );
}

export async function fetchMembers(workspaceId: string): Promise<MembersResponse> {
  return unwrap(
    await fetch(`/api/workspaces/${workspaceId}/members`, { cache: "no-store" })
  );
}

export async function inviteMember(
  workspaceId: string,
  email: string,
  role: WorkspaceRole
): Promise<Invitation> {
  return unwrap(
    await fetch(`/api/workspaces/${workspaceId}/invitations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, role }),
    })
  );
}

export async function updateMemberRole(
  workspaceId: string,
  userId: string,
  role: WorkspaceRole
): Promise<Member> {
  return unwrap(
    await fetch(`/api/workspaces/${workspaceId}/members/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    })
  );
}

export async function removeMember(
  workspaceId: string,
  userId: string
): Promise<void> {
  return unwrap(
    await fetch(`/api/workspaces/${workspaceId}/members/${userId}`, {
      method: "DELETE",
    })
  );
}

export async function revokeInvitation(id: string): Promise<void> {
  return unwrap(await fetch(`/api/invitations/${id}`, { method: "DELETE" }));
}
