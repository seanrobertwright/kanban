import type { RunDetail } from "../types";

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
