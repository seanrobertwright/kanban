import { randomUUID } from "node:crypto";

import { query, queryOne, withTransaction } from "@/shared/db/client";
import { unassignFromWorkspace } from "@/features/tasks/server/repository";
import { AuthzError, requireWorkspaceRole, ROLE_RANK } from "./authz";
import type { Invitation, Member, WorkspaceRole } from "../types";

const ROLES: WorkspaceRole[] = ["owner", "admin", "member", "viewer"];

export function isWorkspaceRole(value: unknown): value is WorkspaceRole {
  return typeof value === "string" && ROLES.includes(value as WorkspaceRole);
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Owner is the only role that can create or modify another owner. Without this,
 * an admin could promote themselves to owner (or demote the real one) and take
 * the workspace — "admin" would just be "owner" with extra steps.
 */
function assertMayAssign(actorRole: WorkspaceRole, targetRole: WorkspaceRole) {
  if (targetRole === "owner" && actorRole !== "owner") {
    throw new AuthzError("forbidden", "Only an owner can grant the owner role");
  }
}

function assertMayModify(actorRole: WorkspaceRole, subjectRole: WorkspaceRole) {
  if (subjectRole === "owner" && actorRole !== "owner") {
    throw new AuthzError("forbidden", "Only an owner can modify another owner");
  }
}

async function countOwners(workspaceId: string): Promise<number> {
  const row = await queryOne<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM workspace_member
      WHERE workspace_id = $1 AND role = 'owner'`,
    [workspaceId]
  );
  return row?.count ?? 0;
}

/**
 * A workspace with no owner cannot be administered by anyone and cannot be
 * deleted — it is unreachable state, so refuse the last step that would create it.
 */
async function assertNotLastOwner(
  workspaceId: string,
  subjectRole: WorkspaceRole,
  action: string
) {
  if (subjectRole !== "owner") return;
  if ((await countOwners(workspaceId)) <= 1) {
    throw new AuthzError(
      "conflict",
      `Cannot ${action} the last owner of this workspace. Promote another owner first.`
    );
  }
}

async function getMemberRole(
  workspaceId: string,
  userId: string
): Promise<WorkspaceRole> {
  const row = await queryOne<{ role: WorkspaceRole }>(
    `SELECT role FROM workspace_member WHERE workspace_id = $1 AND user_id = $2`,
    [workspaceId, userId]
  );
  if (!row) throw new AuthzError("not_found", "Member not found");
  return row.role;
}

export async function listMembers(
  actorId: string,
  workspaceId: string
): Promise<Member[]> {
  await requireWorkspaceRole(actorId, workspaceId, "viewer");
  return query<Member>(
    `SELECT u.id AS "userId", u.name, u.email, u.image, wm.role,
            wm.created_at AS "createdAt"
       FROM workspace_member wm
       JOIN "user" u ON u.id = wm.user_id
      WHERE wm.workspace_id = $1
      ORDER BY wm.created_at`,
    [workspaceId]
  );
}

export async function listInvitations(
  actorId: string,
  workspaceId: string
): Promise<Invitation[]> {
  // Admin-only: the pending list is a list of people's email addresses.
  await requireWorkspaceRole(actorId, workspaceId, "admin");
  return query<Invitation>(
    `SELECT id, workspace_id AS "workspaceId", email, role,
            created_at AS "createdAt", expires_at AS "expiresAt"
       FROM workspace_invitation
      WHERE workspace_id = $1 AND expires_at > now()
      ORDER BY created_at`,
    [workspaceId]
  );
}

export async function inviteMember(
  actorId: string,
  workspaceId: string,
  email: string,
  role: WorkspaceRole
): Promise<Invitation> {
  const actorRole = await requireWorkspaceRole(actorId, workspaceId, "admin");
  assertMayAssign(actorRole, role);

  const normalized = normalizeEmail(email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)) {
    throw new AuthzError("conflict", "That is not a valid email address");
  }

  const alreadyMember = await queryOne<{ id: string }>(
    `SELECT u.id FROM workspace_member wm
       JOIN "user" u ON u.id = wm.user_id
      WHERE wm.workspace_id = $1 AND lower(u.email) = $2`,
    [workspaceId, normalized]
  );
  if (alreadyMember) {
    throw new AuthzError("conflict", "That person is already a member");
  }

  // Re-inviting overwrites the pending row rather than erroring, so an admin can
  // correct a role they got wrong without hunting for a revoke button.
  const invitation = await queryOne<Invitation>(
    `INSERT INTO workspace_invitation (id, workspace_id, email, role, invited_by)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (workspace_id, lower(email))
       DO UPDATE SET role = EXCLUDED.role,
                     invited_by = EXCLUDED.invited_by,
                     created_at = now(),
                     expires_at = now() + interval '14 days'
     RETURNING id, workspace_id AS "workspaceId", email, role,
               created_at AS "createdAt", expires_at AS "expiresAt"`,
    [randomUUID(), workspaceId, normalized, role, actorId]
  );
  return invitation!;
}

export async function revokeInvitation(
  actorId: string,
  invitationId: string
): Promise<boolean> {
  const invitation = await queryOne<{ workspaceId: string }>(
    `SELECT workspace_id AS "workspaceId" FROM workspace_invitation WHERE id = $1`,
    [invitationId]
  );
  if (!invitation) throw new AuthzError("not_found", "Invitation not found");
  await requireWorkspaceRole(actorId, invitation.workspaceId, "admin");
  const rows = await query(
    `DELETE FROM workspace_invitation WHERE id = $1 RETURNING id`,
    [invitationId]
  );
  return rows.length > 0;
}

export async function updateMemberRole(
  actorId: string,
  workspaceId: string,
  userId: string,
  role: WorkspaceRole
): Promise<Member> {
  const actorRole = await requireWorkspaceRole(actorId, workspaceId, "admin");
  const subjectRole = await getMemberRole(workspaceId, userId);

  assertMayModify(actorRole, subjectRole);
  assertMayAssign(actorRole, role);
  if (role !== "owner") {
    await assertNotLastOwner(workspaceId, subjectRole, "demote");
  }

  await query(
    `UPDATE workspace_member SET role = $3
      WHERE workspace_id = $1 AND user_id = $2`,
    [workspaceId, userId, role]
  );
  const members = await listMembers(actorId, workspaceId);
  return members.find((m) => m.userId === userId)!;
}

export async function removeMember(
  actorId: string,
  workspaceId: string,
  userId: string
): Promise<boolean> {
  const isSelf = actorId === userId;
  // Leaving is not an admin action. Anyone may remove themselves; removing
  // someone else takes admin.
  const actorRole = await requireWorkspaceRole(
    actorId,
    workspaceId,
    isSelf ? "viewer" : "admin"
  );
  const subjectRole = await getMemberRole(workspaceId, userId);

  if (!isSelf) assertMayModify(actorRole, subjectRole);
  await assertNotLastOwner(workspaceId, subjectRole, isSelf ? "leave as" : "remove");

  // Both statements in one transaction: dropping the membership without
  // clearing the assignments would leave tasks assigned to someone who is no
  // longer a member — the state assertAssignable refuses to create on the way
  // in, arrived at through the back door. The unassignments are attributed to
  // whoever removed them, which is the truth: an admin removing a member is the
  // actor behind every card that comes free.
  return withTransaction(async (client) => {
    await unassignFromWorkspace(client, workspaceId, userId, {
      type: "human",
      id: actorId,
    });

    const { rows } = await client.query(
      `DELETE FROM workspace_member
        WHERE workspace_id = $1 AND user_id = $2 RETURNING user_id`,
      [workspaceId, userId]
    );
    return rows.length > 0;
  });
}

/**
 * Turns any unexpired invitations matching this user's email into memberships.
 * Called on every page load, which is cheap (one indexed lookup) and means an
 * invite lands the moment the invitee next opens the app — the closest thing to
 * delivery available with no email provider configured.
 */
export async function redeemInvitations(
  userId: string,
  email: string | null | undefined
): Promise<number> {
  if (!email) return 0;
  const normalized = normalizeEmail(email);

  return withTransaction(async (client) => {
    const { rows } = await client.query<{ workspace_id: string; role: WorkspaceRole }>(
      `SELECT workspace_id, role FROM workspace_invitation
        WHERE lower(email) = $1 AND expires_at > now()`,
      [normalized]
    );
    if (rows.length === 0) return 0;

    for (const row of rows) {
      // DO NOTHING, not DO UPDATE: an existing membership wins. A stale invite
      // must never silently downgrade (or upgrade) someone's current role.
      await client.query(
        `INSERT INTO workspace_member (workspace_id, user_id, role)
         VALUES ($1, $2, $3)
         ON CONFLICT (workspace_id, user_id) DO NOTHING`,
        [row.workspace_id, userId, row.role]
      );
    }
    await client.query(`DELETE FROM workspace_invitation WHERE lower(email) = $1`, [
      normalized,
    ]);
    return rows.length;
  });
}
