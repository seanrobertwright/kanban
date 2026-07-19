import type { WorkspaceRole } from "@/features/workspaces/types";

/** §8's two doors as a schema fact: native = one we host and drive (Door 1,
 *  carries a model + prompt); external = one the customer runs and points at us
 *  over MCP (Door 2, carries a credential). 009's enum, surfaced to the client. */
export type AgentKind = "native" | "external";

/** §7.4's three approval gates — the tier an agent_action passed through (013). */
export type AgentTier = "auto" | "changeset" | "block";

/** One gated tool call, as the review panel reads it. */
export interface AgentActionView {
  id: string;
  tool: string;
  tier: AgentTier;
  input: unknown;
  result: unknown;
  before: unknown;
  after: unknown;
  approvedBy: string | null;
  revertedAt: string | null;
  createdAt: string;
}

/** One agent run with its action trail and pending changeset (013) — the shape
 *  behind the task dialog's review panel. */
export interface RunDetail {
  id: string;
  agentId: string;
  taskId: number | null;
  status: string;
  costMicros: number;
  actions: AgentActionView[];
  changeset: { id: string; status: string } | null;
}

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

/**
 * An agent as the *management* surface reads it — AgentSummary plus the fields
 * that distinguish the two kinds (012): the kind itself, and the model a native
 * one runs on. This is the admin view, one rank richer than the assignee-picker's
 * AgentSummary, and like it, it never carries the token — only the sha256 hash is
 * stored (009), so there is nothing to return.
 */
export interface AgentDetail extends AgentSummary {
  kind: AgentKind;
  /** The model a native agent runs on; null for an external one (012). */
  model: string | null;
  createdAt: string;
}

/** What the create form sends. A native agent needs a model and may carry a
 *  system prompt; an external one needs neither and is minted a token. The
 *  server holds each kind to its own fields — 012's agent_kind_fields CHECK. */
export interface NewAgentInput {
  name: string;
  role: WorkspaceRole;
  kind: AgentKind;
  image?: string | null;
  /** Required when kind === "native"; ignored otherwise. */
  model?: string | null;
  /** Optional native system prompt; ignored for an external agent. */
  systemPrompt?: string | null;
}

/**
 * The create response — the one and only time an external agent's raw token
 * exists outside the caller. `token` is present for a freshly-minted external
 * agent and absent for a native one (which authenticates nothing). It is never
 * returned again: the list read has no token to give, because the row holds only
 * the hash. The client must surface it once and tell the operator so.
 */
export interface CreatedAgent {
  agent: AgentDetail;
  token?: string;
}

/** A workspace's agent budget (§7.3), as the settings surface reads it — the cap
 *  and the month-to-date spend, both in micro-dollars, both null-safe. */
export interface WorkspaceBudget {
  capMicros: number | null;
  spentMicros: number;
}
