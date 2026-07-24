import type {
  Board,
  Invitation,
  Member,
  NewWorkspace,
  Portfolio,
  WorkspaceRole,
} from "../types";
import type { AdminSummary, DiscoveryHit, IdentityProvider, IpAllowlistEntry, LegalHold, PermissionGrant, RetentionPolicy } from "@/features/admin/types";
import type { IntegrationConnection } from "@/features/integrations/types";

export interface MembersResponse {
  members: Member[];
  /** Always empty for non-admins — the server withholds pending emails. */
  invitations: Invitation[];
}

/** Surfaces the server's message, which carries the reason (last owner, etc.). */
async function unwrap<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `Request failed (${res.status})`);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

/** Every board in the workspace rolled up into one glance (040). */
export async function fetchPortfolio(workspaceId: string): Promise<Portfolio> {
  return unwrap(
    await fetch(`/api/workspaces/${workspaceId}/portfolio`, {
      cache: "no-store",
    })
  );
}

export async function createWorkspace(name: string): Promise<NewWorkspace> {
  return unwrap(
    await fetch("/api/workspaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    })
  );
}

export async function createBoard(
  workspaceId: string,
  name: string
): Promise<Board> {
  return unwrap(
    await fetch(`/api/workspaces/${workspaceId}/boards`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    })
  );
}

export async function fetchMembers(workspaceId: string): Promise<MembersResponse> {
  return unwrap(
    await fetch(`/api/workspaces/${workspaceId}/members`, { cache: "no-store" })
  );
}

export async function inviteMember(
  workspaceId: string,
  email: string,
  role: WorkspaceRole
): Promise<Invitation> {
  return unwrap(
    await fetch(`/api/workspaces/${workspaceId}/invitations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, role }),
    })
  );
}

export async function updateMemberRole(
  workspaceId: string,
  userId: string,
  role: WorkspaceRole
): Promise<Member> {
  return unwrap(
    await fetch(`/api/workspaces/${workspaceId}/members/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    })
  );
}

export async function removeMember(
  workspaceId: string,
  userId: string
): Promise<void> {
  return unwrap(
    await fetch(`/api/workspaces/${workspaceId}/members/${userId}`, {
      method: "DELETE",
    })
  );
}

export async function revokeInvitation(id: string): Promise<void> {
  return unwrap(await fetch(`/api/invitations/${id}`, { method: "DELETE" }));
}

export async function fetchIpAllowlist(workspaceId: string): Promise<IpAllowlistEntry[]> {
  return unwrap(await fetch(`/api/workspaces/${workspaceId}/ip-allowlist`, { cache: "no-store" }));
}
export async function fetchAdminSummary(workspaceId: string): Promise<AdminSummary> {
  return unwrap(await fetch(`/api/workspaces/${workspaceId}/admin-summary`, { cache: "no-store" }));
}
export async function addIpAllowlistEntry(workspaceId: string, cidr: string, label: string): Promise<IpAllowlistEntry> {
  return unwrap(await fetch(`/api/workspaces/${workspaceId}/ip-allowlist`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cidr, label }) }));
}
export async function deleteIpAllowlistEntry(workspaceId: string, entryId: number): Promise<void> {
  return unwrap(await fetch(`/api/workspaces/${workspaceId}/ip-allowlist/${entryId}`, { method: "DELETE" }));
}
export async function fetchBoardGrants(workspaceId: string): Promise<PermissionGrant[]> { return unwrap(await fetch(`/api/workspaces/${workspaceId}/permissions`, { cache: "no-store" })); }
export async function grantBoardPermission(workspaceId: string, input: Omit<PermissionGrant, "id" | "workspaceId" | "createdAt" | "subjectType">): Promise<PermissionGrant> { return unwrap(await fetch(`/api/workspaces/${workspaceId}/permissions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) })); }
export async function revokeBoardGrant(workspaceId: string, id: string): Promise<void> { return unwrap(await fetch(`/api/workspaces/${workspaceId}/permissions/${id}`, { method: "DELETE" })); }
export async function fetchRetentionPolicies(workspaceId: string): Promise<RetentionPolicy[]> { return unwrap(await fetch(`/api/workspaces/${workspaceId}/retention`, { cache: "no-store" })); }
export async function saveRetentionPolicy(workspaceId: string, subjectType: RetentionPolicy["subjectType"], maxAgeDays: number): Promise<RetentionPolicy> { return unwrap(await fetch(`/api/workspaces/${workspaceId}/retention`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subjectType, maxAgeDays }) })); }
export async function fetchLegalHolds(workspaceId: string): Promise<LegalHold[]> { return unwrap(await fetch(`/api/workspaces/${workspaceId}/legal-holds`, { cache: "no-store" })); }
export async function placeLegalHold(workspaceId: string, subjectType: LegalHold["subjectType"], subjectId: string, reason: string): Promise<{ id: string }> { return unwrap(await fetch(`/api/workspaces/${workspaceId}/legal-holds`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subjectType, subjectId, reason }) })); }
export async function releaseLegalHold(workspaceId: string, holdId: string): Promise<void> { return unwrap(await fetch(`/api/workspaces/${workspaceId}/legal-holds/${holdId}`, { method: "DELETE" })); }
export async function searchDiscovery(workspaceId: string, term: string): Promise<DiscoveryHit[]> { return unwrap(await fetch(`/api/workspaces/${workspaceId}/ediscovery?q=${encodeURIComponent(term)}`, { cache: "no-store" })); }
export async function fetchIdentityProviders(workspaceId: string): Promise<IdentityProvider[]> { return unwrap(await fetch(`/api/workspaces/${workspaceId}/identity-providers`, { cache: "no-store" })); }
export async function registerIdentityProvider(workspaceId: string, input: Record<string, unknown>): Promise<void> { return unwrap(await fetch(`/api/workspaces/${workspaceId}/identity-providers`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) })); }
export async function removeIdentityProvider(workspaceId: string, providerId: string): Promise<void> { return unwrap(await fetch(`/api/workspaces/${workspaceId}/identity-providers/${encodeURIComponent(providerId)}`, { method: "DELETE" })); }
export async function generateScimToken(workspaceId: string, providerId: string): Promise<{ scimToken: string }> { return unwrap(await fetch(`/api/workspaces/${workspaceId}/identity-providers/${encodeURIComponent(providerId)}/scim-token`, { method: "POST" })); }
export async function fetchIntegrations(workspaceId: string): Promise<IntegrationConnection[]> { return unwrap(await fetch(`/api/workspaces/${workspaceId}/integrations`, { cache: "no-store" })); }
export async function addTeamsWebhook(workspaceId: string, input: { channelId: string; webhookUrl: string; name?: string }): Promise<IntegrationConnection> { return unwrap(await fetch(`/api/workspaces/${workspaceId}/integrations`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) })); }
export async function removeIntegration(workspaceId: string, connectionId: number): Promise<void> { return unwrap(await fetch(`/api/workspaces/${workspaceId}/integrations/${connectionId}`, { method: "DELETE" })); }
