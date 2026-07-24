export interface Channel { id: number; workspaceId: string; name: string; isPrivate: boolean; createdBy: string; createdAt: string; }
export interface ChatMessage { id: number; channelId: number; authorId: string; body: string; parentId: number | null; createdAt: string; }
