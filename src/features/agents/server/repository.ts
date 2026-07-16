import { query } from "@/shared/db/client";
import type { Principal } from "@/features/auth/server/principal";
import { requireWorkspaceRole } from "@/features/workspaces/server/authz";
import type { AgentSummary } from "../types";

/**
 * The agents of a workspace — the roster the assignee picker shows beside the
 * human members (011), and the list a card resolves an agent assignee's name
 * from. This is precisely the read 009's idx_agent_workspace comment named in
 * advance: "the agents of this workspace, which any future management UI asks by
 * name."
 *
 * Viewer+, matching listMembers: seeing who — person or agent — a task can be
 * handed to is part of reading the board, not editing it. And the columns are
 * exactly Member's, minus nothing and plus nothing: name, image, role. The
 * token_hash is never selected, because a roster is names and faces (see
 * AgentSummary), and ORDER BY name gives the picker a stable, human-readable
 * order with id breaking ties.
 */
export async function listWorkspaceAgents(
  principal: string | Principal,
  workspaceId: string
): Promise<AgentSummary[]> {
  await requireWorkspaceRole(principal, workspaceId, "viewer");
  return query<AgentSummary>(
    `SELECT id, name, image, role FROM agent
      WHERE workspace_id = $1 ORDER BY name, id`,
    [workspaceId]
  );
}
