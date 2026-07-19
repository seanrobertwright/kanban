import type {
  AgentDetail,
  CreatedAgent,
  NewAgentInput,
  RunDetail,
  WorkspaceBudget,
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

/** The latest run for a task, or null if it has never had one. */
export function latestRunForTask(taskId: number): Promise<RunDetail | null> {
  return fetch(`/api/agents/runs?taskId=${taskId}`).then((res) =>
    jsonOrThrow<RunDetail | null>(res)
  );
}

/** Accept the given action ids from a changeset (an empty array rejects all). */
export function reviewChangeset(
  changesetId: string,
  accept: string[]
): Promise<RunDetail> {
  return fetch(`/api/agents/changesets/${changesetId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accept }),
  }).then((res) => jsonOrThrow<RunDetail>(res));
}

/** Undo one auto-tier action. */
export function revertAction(actionId: string): Promise<void> {
  return fetch(`/api/agents/actions/${actionId}/revert`, {
    method: "POST",
  }).then(async (res) => {
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(
        (body as { error?: string } | null)?.error ?? `Request failed (${res.status})`
      );
    }
  });
}

// --- Agent management (admin) ---

/** Every agent in a workspace (admin-only server-side). */
export function fetchAgents(workspaceId: string): Promise<AgentDetail[]> {
  return fetch(`/api/workspaces/${workspaceId}/agents`, {
    cache: "no-store",
  }).then((res) => jsonOrThrow<AgentDetail[]>(res));
}

/** Mint an agent. The returned `token` (external kind only) is shown once. */
export function createAgent(
  workspaceId: string,
  input: NewAgentInput
): Promise<CreatedAgent> {
  return fetch(`/api/workspaces/${workspaceId}/agents`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((res) => jsonOrThrow<CreatedAgent>(res));
}

/** Retire an agent. Rejects (409) if it has a run in flight. */
export function deleteAgent(workspaceId: string, agentId: string): Promise<void> {
  return fetch(`/api/workspaces/${workspaceId}/agents/${agentId}`, {
    method: "DELETE",
  }).then(async (res) => {
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(
        (body as { error?: string } | null)?.error ?? `Request failed (${res.status})`
      );
    }
  });
}

/** The workspace's agent budget — cap and month-to-date spend, micro-dollars. */
export function fetchBudget(workspaceId: string): Promise<WorkspaceBudget> {
  return fetch(`/api/workspaces/${workspaceId}/budget`, {
    cache: "no-store",
  }).then((res) => jsonOrThrow<WorkspaceBudget>(res));
}

/** Set or clear the cap. `capMicros` null = uncapped. */
export function setBudget(
  workspaceId: string,
  capMicros: number | null
): Promise<WorkspaceBudget> {
  return fetch(`/api/workspaces/${workspaceId}/budget`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ capMicros }),
  }).then((res) => jsonOrThrow<WorkspaceBudget>(res));
}
