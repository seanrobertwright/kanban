import type {
  GitProvider,
  RepoBranch,
  RepoConnection,
  RepoEntry,
  TaskCiStatus,
  TaskGitLink,
} from "../types";

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
  input: {
    provider: GitProvider;
    externalRepo: string;
    installId?: string;
    /** Provider access token for browsing — stored encrypted, never read back. */
    accessToken?: string;
  }
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

export async function fetchRepoBranches(
  connectionId: number
): Promise<RepoBranch[]> {
  const res = await fetch(`/api/repo-connections/${connectionId}/branches`);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? "Failed to load branches");
  }
  return res.json();
}

export async function fetchRepoTree(
  connectionId: number,
  opts: { path?: string; ref?: string } = {}
): Promise<RepoEntry[]> {
  const q = new URLSearchParams();
  if (opts.path) q.set("path", opts.path);
  if (opts.ref) q.set("ref", opts.ref);
  const suffix = q.size > 0 ? `?${q}` : "";
  const res = await fetch(`/api/repo-connections/${connectionId}/tree${suffix}`);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? "Failed to load the repository tree");
  }
  return res.json();
}

export async function fetchTaskGitLinks(taskId: number): Promise<TaskGitLink[]> {
  const res = await fetch(`/api/tasks/${taskId}/git-links`);
  if (!res.ok) throw new Error("Failed to load development links");
  return res.json();
}

export async function fetchTaskCiStatuses(
  taskId: number
): Promise<TaskCiStatus[]> {
  const res = await fetch(`/api/tasks/${taskId}/ci-status`);
  if (!res.ok) throw new Error("Failed to load CI status");
  return res.json();
}
