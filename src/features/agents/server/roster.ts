import { query } from "@/shared/db/client";
import type { Principal } from "@/features/auth/server/principal";
import { requireWorkspaceRole } from "@/features/workspaces/server/authz";
import type { WorkspaceRole } from "@/features/workspaces/types";
import type { AgentSummary } from "../types";

/**
 * The assignment roster an agent reads over the API — who it can hand a task to.
 *
 * Deliberately NOT listMembers: that read returns members' email addresses, and
 * an external agent has no business with a workspace's email list (the same
 * reason M0 made pending invitations admin-only). This is the email-free subset
 * an assignee picker actually needs — id, name, avatar, role — for people AND
 * agents, since a task can be assigned to either (011, the peers).
 *
 * Viewer+, and requireWorkspaceRole scopes an agent to its own workspace, so an
 * agent reads only the roster of the workspace it belongs to.
 */
export interface AssignableMember {
  userId: string;
  name: string;
  image: string | null;
  role: WorkspaceRole;
}

export interface Assignees {
  members: AssignableMember[];
  agents: AgentSummary[];
}

export async function listAssignees(
  principal: string | Principal,
  workspaceId: string
): Promise<Assignees> {
  await requireWorkspaceRole(principal, workspaceId, "viewer");

  const members = await query<AssignableMember>(
    `SELECT u.id AS "userId", u.name, u.image, wm.role
       FROM workspace_member wm
       JOIN "user" u ON u.id = wm.user_id
      WHERE wm.workspace_id = $1
      ORDER BY u.name, u.id`,
    [workspaceId]
  );
  const agents = await query<AgentSummary>(
    `SELECT id, name, image, role FROM agent
      WHERE workspace_id = $1 ORDER BY name, id`,
    [workspaceId]
  );
  return { members, agents };
}
