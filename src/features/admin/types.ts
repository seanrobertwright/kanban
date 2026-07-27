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
/** One custom-field access rule: what a workspace role may see/change (§SQL
 * enforcement in custom-fields repository; this is its management surface). */
export interface CustomFieldPolicy { fieldId: number; fieldName: string; boardId: number; role: string; canView: boolean; canEdit: boolean; }
/** One workspace-wide audit row for the admin console's viewer (read path). */
export interface AuditEvent { id: string; boardId: number | null; taskId: number | null; actorType: "human" | "agent"; actorId: string; actorName: string | null; action: string; createdAt: string; }
/** A board's inbound email address, when the deployment configures intake. */
export interface BoardIntakeAddress { boardId: number; boardName: string; address: string; }
export interface PermissionGrant { id: string; workspaceId: string; subjectType: "board"; subjectId: string; principalType: "user" | "workspace_role"; principalId: string; capability: "read" | "write" | "manage"; createdAt: string; }
export interface RetentionPolicy { id: number; subjectType: "activity_log" | "task" | "comment" | "attachment" | "doc"; maxAgeDays: number; }
export interface LegalHold { id: string; subjectType: "task" | "comment" | "attachment" | "doc"; subjectId: string; reason: string; createdAt: string; }
export interface IdentityProvider { providerId: string; protocol: "oidc" | "saml"; issuer: string; domain: string; createdAt: string; }
/** `onHold`: an active legal hold (064) covers this record — the first thing a
 *  compliance reader wants to know about a hit. Always false for audit rows,
 *  which holds have no subject type for. */
export interface DiscoveryHit { subjectType: "task" | "comment" | "doc" | "activity"; id: string; title: string; excerpt: string; createdAt: string; onHold: boolean; }
