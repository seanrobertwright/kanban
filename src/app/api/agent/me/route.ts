import { getPrincipalFromRequest } from "@/features/auth/server/agent-auth";
import { unauthorized } from "@/features/auth/server/session";
import { query, queryOne } from "@/shared/db/client";

export const dynamic = "force-dynamic";

/**
 * A caller's own identity and the boards it can reach — the first call of any
 * headless client (the MCP server, the CLI), so tools can default to a real
 * board without the operator hand-wiring ids.
 *
 * Two branches for the two headless credential classes, each answering with
 * the shape its principal has:
 *
 *  - **agent** — `{ id, name, workspaceId, boards }`. An agent belongs to one
 *    workspace (009), so its workspace is a scalar and its boards are read
 *    straight by workspace_id — the token is the scope, no per-row authz.
 *  - **human** (personal API key; a cookie works too) — `{ kind: "human", id,
 *    name, workspaces, boards }`. A person belongs to many workspaces, so the
 *    workspace is a list and each board row carries its workspaceId. The reads
 *    go through workspace_member, which IS the authz: the boards of the
 *    workspaces you are a member of, and nothing else.
 *
 * A client tells them apart by `kind` ("human") or the presence of a scalar
 * `workspaceId` (agent) — the agent shape predates the human one and is
 * deliberately byte-for-byte unchanged.
 */
export async function GET(request: Request) {
  const principal = await getPrincipalFromRequest(request);
  if (!principal) return unauthorized();
  if (principal.kind === "human") {
    const user = await queryOne<{ id: string; name: string }>(
      `SELECT id, name FROM "user" WHERE id = $1`,
      [principal.userId]
    );
    if (!user) return unauthorized();

    const workspaces = await query<{ id: string; name: string; role: string }>(
      `SELECT w.id, w.name, m.role
         FROM workspace_member m
         JOIN workspace w ON w.id = m.workspace_id
        WHERE m.user_id = $1
        ORDER BY w.name, w.id`,
      [principal.userId]
    );
    const boards = await query<{ id: number; name: string; workspaceId: string }>(
      `SELECT b.id, b.name, b.workspace_id AS "workspaceId"
         FROM board b
         JOIN workspace_member m ON m.workspace_id = b.workspace_id
        WHERE m.user_id = $1
        ORDER BY b.workspace_id, b.position, b.id`,
      [principal.userId]
    );
    return Response.json({ kind: "human", ...user, workspaces, boards });
  }

  const agent = await queryOne<{
    id: string;
    name: string;
    workspaceId: string;
  }>(
    `SELECT id, name, workspace_id AS "workspaceId" FROM agent WHERE id = $1`,
    [principal.agentId]
  );
  // The token resolved a moment ago but the row is gone — deleted mid-request.
  // 401, because the credential no longer identifies anyone.
  if (!agent) return unauthorized();

  const boards = await query<{ id: number; name: string }>(
    `SELECT id, name FROM board WHERE workspace_id = $1 ORDER BY position, id`,
    [principal.workspaceId]
  );
  return Response.json({ ...agent, boards });
}
