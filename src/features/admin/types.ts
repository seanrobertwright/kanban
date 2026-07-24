export interface IpAllowlistEntry {
  id: number;
  cidr: string;
  label: string;
  createdAt: string;
}

export interface AdminSummary {
  members: number;
  agents: number;
  boards: number;
  webhooks: number;
  auditEvents: number;
}
export interface PermissionGrant { id: string; workspaceId: string; subjectType: "board"; subjectId: string; principalType: "user" | "workspace_role"; principalId: string; capability: "read" | "write" | "manage"; createdAt: string; }
export interface RetentionPolicy { id: number; subjectType: "activity_log" | "task" | "comment" | "attachment" | "doc"; maxAgeDays: number; }
export interface LegalHold { id: string; subjectType: "task" | "comment" | "attachment" | "doc"; subjectId: string; reason: string; createdAt: string; }
export interface IdentityProvider { providerId: string; protocol: "oidc" | "saml"; issuer: string; domain: string; createdAt: string; }
export interface DiscoveryHit { subjectType: "task" | "comment" | "doc" | "activity"; id: string; title: string; excerpt: string; createdAt: string; }
