import type { Actor } from "@/features/activity/types";

/**
 * Who is acting — a person or an agent. The whole M2 wedge in a type: PRD §8
 * makes the two peers, "an agent is a principal, not a bypass" (§7.2), and this
 * is where the codebase first has to say which one it is holding.
 *
 * A human is identified by a user id and their role is looked up per workspace
 * (workspace_member). An agent carries its workspace with it — it belongs to
 * exactly one (§8, 009) — and its role lives on its own row. That difference is
 * exactly what the two authz branches key on.
 */
export type Principal =
  | { kind: "human"; userId: string }
  | { kind: "agent"; agentId: string; workspaceId: string };

/**
 * The back-compatibility seam, and the reason the whole change touches no
 * existing caller or test. Every function that took a `userId: string` now takes
 * `string | Principal`; a bare string means a human, which is what every current
 * call site already passes. Only the new agent path constructs the object.
 */
export function asPrincipal(principal: string | Principal): Principal {
  return typeof principal === "string"
    ? { kind: "human", userId: principal }
    : principal;
}

/**
 * The audit actor for a principal — what `logActivity` stamps on every row. This
 * is what makes history read "Triage Bot moved this" rather than attributing an
 * agent's work to whoever minted its token. `actor_type = 'agent'` and an
 * unconstrained `actor_id` (003) are what let the agent's own id land here.
 */
export function principalActor(principal: Principal): Actor {
  return principal.kind === "human"
    ? { type: "human", id: principal.userId }
    : { type: "agent", id: principal.agentId };
}
