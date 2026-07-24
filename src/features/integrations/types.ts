export type IntegrationProvider = "slack" | "teams" | "email" | "google" | "microsoft";

export interface IntegrationConnection {
  id: number;
  workspaceId: string;
  provider: IntegrationProvider;
  externalId: string;
  scopes: string[];
  metadata: Record<string, unknown>;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface SlackConnection extends IntegrationConnection {
  provider: "slack";
  metadata: { teamName?: string; botUserId?: string; [key: string]: unknown };
}
