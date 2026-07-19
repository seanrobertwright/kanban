import { createHash, randomBytes, randomUUID } from "node:crypto";

import { query, queryOne, withTransaction } from "@/shared/db/client";
import {
  releaseAgentClaims,
  unassignAgent,
} from "@/features/tasks/server/repository";
import { requireWorkspaceRole, AuthzError } from "@/features/workspaces/server/authz";
import type { AgentDetail, CreatedAgent, NewAgentInput } from "../types";

/**
 * The agent-management surface — the human, admin-side counterpart to the
 * roster an agent reads (roster.ts). Where the runtime and MCP door let an agent
 * *act*, this is where an admin brings one into being, sees the ones a workspace
 * has, and retires one. Until it existed the only door in was scripts/create-agent.mjs
 * (§8's provisioner), which is fine for an operator with shell access and nothing
 * to a workspace admin in a browser — PRD §11's success bar is a *human* running
 * the loop unaided, and that starts with creating the agent.
 *
 * Every call here is admin+, mirroring members.ts: creating an agent mints a
 * principal that can act on the board, and deleting one retires it — both are the
 * management of who may touch a workspace, which is an admin concern, not a
 * member's. The list is admin-only for the same reason listInvitations is: it
 * carries configuration (a native agent's model, its kind) that the assignee
 * picker's viewer-level roster deliberately omits.
 */

const SELECT_AGENT = `SELECT id, name, image, role, kind, model,
                             created_at AS "createdAt"
                        FROM agent`;

export async function listAgents(
  actorId: string,
  workspaceId: string
): Promise<AgentDetail[]> {
  await requireWorkspaceRole(actorId, workspaceId, "admin");
  return query<AgentDetail>(
    `${SELECT_AGENT} WHERE workspace_id = $1 ORDER BY name, id`,
    [workspaceId]
  );
}

/**
 * Mints an agent. The token is the whole reason this returns a bespoke shape
 * rather than a bare AgentDetail: an external agent is handed a bearer token that
 * exists exactly once, here, and is stored only as its sha256 (009). The caller
 * surfaces it a single time; no later read can recover it. A native agent mints
 * no token — nothing external authenticates as it (012) — so `token` is absent.
 *
 * The hashing is create-agent.mjs's, reproduced so both provisioning paths mint
 * identically-shaped credentials: `kbn_` + 32 random bytes, sha256 stored. The
 * prefix keeps a leaked token greppable; 256 bits of entropy is why the store can
 * be a bare sha256 with no KDF (agent-auth.ts).
 */
export async function createAgent(
  actorId: string,
  workspaceId: string,
  input: NewAgentInput
): Promise<CreatedAgent> {
  const actorRole = await requireWorkspaceRole(actorId, workspaceId, "admin");

  // The same escalation guard members.ts draws for humans: only an owner may
  // grant the owner role. An owner *agent* driven by the runtime could do
  // owner-only things, so an admin minting one would be self-promotion by proxy.
  if (input.role === "owner" && actorRole !== "owner") {
    throw new AuthzError("forbidden", "Only an owner can grant the owner role");
  }

  const id = randomUUID();
  const image = input.image ?? null;

  if (input.kind === "native") {
    // model presence is the handler's 400 to make; the 012 CHECK is the backstop.
    const agent = await queryOne<AgentDetail>(
      `INSERT INTO agent (id, workspace_id, name, image, role, kind, model, system_prompt)
       VALUES ($1, $2, $3, $4, $5, 'native', $6, $7)
       RETURNING id, name, image, role, kind, model, created_at AS "createdAt"`,
      [id, workspaceId, input.name, image, input.role, input.model, input.systemPrompt ?? null]
    );
    return { agent: agent! };
  }

  const token = `kbn_${randomBytes(32).toString("hex")}`;
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const agent = await queryOne<AgentDetail>(
    `INSERT INTO agent (id, workspace_id, name, image, role, kind, token_hash)
     VALUES ($1, $2, $3, $4, $5, 'external', $6)
     RETURNING id, name, image, role, kind, model, created_at AS "createdAt"`,
    [id, workspaceId, input.name, image, input.role, tokenHash]
  );
  return { agent: agent!, token };
}

/**
 * Retires an agent. Two things make this more than a DELETE, and both are the
 * cost of the agent having become a live principal on the board:
 *
 * 1. **An active run is refused (409), not steamrolled.** A run that is queued,
 *    running, or awaiting_review is work in flight — and awaiting_review is a
 *    changeset a human still has to accept or reject. Deleting the agent would
 *    CASCADE that run and its pending changeset out of existence (013), silently
 *    dropping a review someone owes an answer to. Same call 007 made for a
 *    populated column: a delete that would destroy work-in-progress is refused
 *    until the human deals with it, and 409 (not 403) because the admin is
 *    *allowed* to attempt it — it is a state that says not yet, not a permission.
 *
 * 2. **Its claims and assignments are swept first, logged.** task.claimed_by has
 *    no FK (010), so a raw DELETE strands a hold that blocks the task forever;
 *    task.agent_id SET-NULLs silently, losing the audit row. releaseAgentClaims
 *    and unassignAgent close both, attributed to the admin who deleted it — the
 *    actor behind every card that comes free.
 *
 * The agent's *past* actions are not touched: activity_log.actor_id carries no FK
 * (009), so the record of what the agent did outlives the agent, and the feed
 * resolves its now-absent name by LEFT JOIN. Retiring an agent is not erasing its
 * history.
 */
export async function deleteAgent(
  actorId: string,
  workspaceId: string,
  agentId: string
): Promise<void> {
  await requireWorkspaceRole(actorId, workspaceId, "admin");

  await withTransaction(async (client) => {
    // FOR UPDATE serializes against a concurrent assignment; the agent_id FK is
    // the real backstop (a task assigned to a deleted agent violates it), but the
    // lock also scopes the agent to this workspace — a foreign id resolves to no
    // row and reports not_found, the same anti-enumeration answer authz gives.
    const found = await client.query(
      `SELECT id FROM agent WHERE id = $1 AND workspace_id = $2 FOR UPDATE`,
      [agentId, workspaceId]
    );
    if (found.rows.length === 0) {
      throw new AuthzError("not_found", "Agent not found");
    }

    const active = await client.query(
      `SELECT 1 FROM agent_run
        WHERE agent_id = $1
          AND status IN ('queued', 'running', 'awaiting_review')
        LIMIT 1`,
      [agentId]
    );
    if (active.rows.length > 0) {
      throw new AuthzError(
        "conflict",
        "This agent has an active run. Review or wait for it to finish before deleting it."
      );
    }

    const actor = { type: "human" as const, id: actorId };
    await releaseAgentClaims(client, workspaceId, agentId, actor);
    await unassignAgent(client, workspaceId, agentId, actor);
    await client.query(`DELETE FROM agent WHERE id = $1 AND workspace_id = $2`, [
      agentId,
      workspaceId,
    ]);
  });
}
