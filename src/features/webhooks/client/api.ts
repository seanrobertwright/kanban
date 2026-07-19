import type { Webhook } from "../types";

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

export async function fetchWebhooks(workspaceId: string): Promise<Webhook[]> {
  const res = await fetch(`/api/workspaces/${workspaceId}/webhooks`, {
    cache: "no-store",
  });
  return jsonOrThrow<Webhook[]>(res);
}

/** The secret comes back exactly once, beside the row. */
export function createWebhook(
  workspaceId: string,
  url: string,
  events?: string[]
): Promise<{ webhook: Webhook; secret: string }> {
  return fetch(`/api/workspaces/${workspaceId}/webhooks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, events }),
  }).then((res) => jsonOrThrow<{ webhook: Webhook; secret: string }>(res));
}

export async function deleteWebhook(id: number): Promise<void> {
  const res = await fetch(`/api/webhooks/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Delete failed (${res.status})`);
}
