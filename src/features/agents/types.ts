import type { WorkspaceRole } from "@/features/workspaces/types";

/**
 * An agent as the board sees it — enough to render it as an assignee beside the
 * humans, and no more. The mirror of Member (workspaces/types), deliberately:
 * the assignee picker treats an agent as another kind of assignee, so it wants
 * the same three fields it wants from a person.
 *
 * No token, ever. A roster is names and faces; the credential is minted once by
 * create-agent and stored only as a hash (009). Nothing that reads a workspace's
 * agents for display has any business seeing it.
 */
export interface AgentSummary {
  id: string;
  name: string;
  image: string | null;
  /**
   * The agent's workspace role (009) — carried for the same reason Member.role
   * is: capacity planning and the picker may want to distinguish what an agent is
   * permitted to do from the fact that it can hold work. A viewer agent can be
   * assigned a task it cannot itself move, exactly as a viewer human can (004).
   */
  role: WorkspaceRole;
}
