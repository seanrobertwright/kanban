export const DOC_TITLE_MAX = 160;
export const DOC_BODY_MAX = 200_000;

export const DOC_KINDS = ["page", "meeting", "decision"] as const;
export type DocKind = (typeof DOC_KINDS)[number];

export interface Doc {
  id: number;
  workspaceId: string;
  boardId: number | null;
  parentId: number | null;
  title: string;
  body: string;
  kind: DocKind;
  position: number;
  isPublished: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface DocRevision {
  id: number;
  docId: number;
  body: string;
  editedBy: string;
  createdAt: string;
}
export interface MeetingAction { title: string; ownerHint: string | null; dueDate: string | null; }

export interface CreateDocInput {
  title: string;
  body?: string;
  kind?: DocKind;
  boardId?: number | null;
  parentId?: number | null;
  isPublished?: boolean;
}

export interface UpdateDocInput {
  title?: string;
  body?: string;
  kind?: DocKind;
  boardId?: number | null;
  parentId?: number | null;
  position?: number;
  isPublished?: boolean;
}

export function isDocKind(value: unknown): value is DocKind {
  return typeof value === "string" && (DOC_KINDS as readonly string[]).includes(value);
}
