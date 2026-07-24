export type KnowledgeSourceKind = "task" | "comment" | "document";

export interface KnowledgeCitation {
  kind: KnowledgeSourceKind;
  id: number;
  title: string;
  excerpt: string;
  taskId: number | null;
}

export interface KnowledgeAnswer {
  answer: string;
  citations: KnowledgeCitation[];
}
