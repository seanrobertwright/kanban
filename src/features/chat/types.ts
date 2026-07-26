export interface Channel {
  id: number;
  workspaceId: string;
  name: string;
  isPrivate: boolean;
  createdBy: string;
  createdAt: string;
  /**
   * Computed per reader at list time (081): someone else's message newer than
   * the reader's last look. Always false on a channel the caller just created.
   */
  hasUnread: boolean;
}

export interface ChatMessage {
  id: number;
  channelId: number;
  authorId: string;
  /** Resolved from "user" at read time; null once the author's row is gone. */
  authorName: string | null;
  body: string;
  parentId: number | null;
  createdAt: string;
}

/** A channel's roster entry, name-joined for display. */
export interface ChannelMember {
  userId: string;
  name: string | null;
}
