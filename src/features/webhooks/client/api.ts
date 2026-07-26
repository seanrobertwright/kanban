import type { Webhook, WebhookDelivery } from "../types";

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

/**
 * Edit a webhook in place. `secret` comes back only when `rotateSecret` was
 * asked for — the caller must show it then, because nothing will show it again.
 */
export function updateWebhook(
  id: number,
  patch: {
    url?: string;
    events?: string[];
    active?: boolean;
    rotateSecret?: boolean;
  }
): Promise<{ webhook: Webhook; secret?: string }> {
  return fetch(`/api/webhooks/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  }).then((res) => jsonOrThrow<{ webhook: Webhook; secret?: string }>(res));
}

export async function fetchDeliveries(id: number): Promise<WebhookDelivery[]> {
  const res = await fetch(`/api/webhooks/${id}/deliveries`, { cache: "no-store" });
  return jsonOrThrow<WebhookDelivery[]>(res);
}

export async function deleteWebhook(id: number): Promise<void> {
  const res = await fetch(`/api/webhooks/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Delete failed (${res.status})`);
}
