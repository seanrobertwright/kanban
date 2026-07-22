import type { GitProvider, RepoConnection, TaskGitLink } from "../types";

/**
 * Git connection + link client (2.0). Connection management is admin-gated
 * server-side; a create returns the signing secret exactly once (shown to the
 * admin, never stored client-side).
 */

export async function fetchConnections(
  workspaceId: string
): Promise<RepoConnection[]> {
  const res = await fetch(`/api/workspaces/${workspaceId}/repo-connections`);
  if (!res.ok) throw new Error("Failed to load repo connections");
  return res.json();
}

export async function createConnection(
  workspaceId: string,
  input: { provider: GitProvider; externalRepo: string; installId?: string }
): Promise<{ connection: RepoConnection; secret: string }> {
  const res = await fetch(`/api/workspaces/${workspaceId}/repo-connections`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? "Failed to connect repository");
  }
  return res.json();
}

export async function deleteConnection(id: number): Promise<void> {
  const res = await fetch(`/api/repo-connections/${id}`, { method: "DELETE" });
  if (!res.ok && res.status !== 204) throw new Error("Failed to disconnect");
}

export async function fetchTaskGitLinks(taskId: number): Promise<TaskGitLink[]> {
  const res = await fetch(`/api/tasks/${taskId}/git-links`);
  if (!res.ok) throw new Error("Failed to load development links");
  return res.json();
}
