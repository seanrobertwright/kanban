import type { Channel, ChannelMember, ChatMessage } from "../types";

async function unwrap<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(
      (body as { error?: string } | null)?.error ?? `Request failed (${res.status})`
    );
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export async function fetchChannels(workspaceId: string): Promise<Channel[]> {
  return unwrap(
    await fetch(`/api/workspaces/${workspaceId}/channels`, { cache: "no-store" })
  );
}

export async function createChannel(
  workspaceId: string,
  name: string,
  isPrivate: boolean
): Promise<Channel> {
  return unwrap(
    await fetch(`/api/workspaces/${workspaceId}/channels`, json({ name, isPrivate }))
  );
}

/** Create or reuse the two-person private channel with `userId` (3.7). */
export async function openDm(
  workspaceId: string,
  userId: string
): Promise<Channel> {
  return unwrap(await fetch(`/api/workspaces/${workspaceId}/dms`, json({ userId })));
}

export async function fetchMessages(channelId: number): Promise<ChatMessage[]> {
  return unwrap(
    await fetch(`/api/channels/${channelId}/messages`, { cache: "no-store" })
  );
}

/** Post a message, threaded under `parentId` when replying. */
export async function sendMessage(
  channelId: number,
  body: string,
  parentId?: number
): Promise<ChatMessage> {
  return unwrap(
    await fetch(
      `/api/channels/${channelId}/messages`,
      json(parentId === undefined ? { body } : { body, parentId })
    )
  );
}

export async function fetchChannelMembers(
  channelId: number
): Promise<ChannelMember[]> {
  return unwrap(
    await fetch(`/api/channels/${channelId}/members`, { cache: "no-store" })
  );
}

export async function addChannelMember(
  channelId: number,
  userId: string
): Promise<void> {
  return unwrap(await fetch(`/api/channels/${channelId}/members`, json({ userId })));
}

export async function removeChannelMember(
  channelId: number,
  userId: string
): Promise<void> {
  return unwrap(
    await fetch(`/api/channels/${channelId}/members/${encodeURIComponent(userId)}`, {
      method: "DELETE",
    })
  );
}

/** Move the reader's unread marker for a channel to now (081). */
export async function markChannelSeen(channelId: number): Promise<void> {
  return unwrap(await fetch(`/api/channels/${channelId}/seen`, { method: "POST" }));
}
