import { getPrincipalFromRequest } from "@/features/auth/server/agent-auth";
import { unauthorized } from "@/features/auth/server/session";
import { query, queryOne } from "@/shared/db/client";

export const dynamic = "force-dynamic";

/**
 * An agent's own identity and the boards it can reach — the MCP server's first
 * call, so its tools can default to a real board without the operator hand-wiring
 * ids. Agent-only by construction: a human has the whole UI for this, and the
 * endpoint exists to answer the one thing a headless agent cannot see for itself,
 * which is which workspace its token dropped it into.
 *
 * Boards are read straight by workspace_id rather than through requireBoardRole
 * per board: the agent's principal already names its workspace (009), so "the
 * boards of my workspace" needs no per-row authz — the token is the scope.
 */
export async function GET(request: Request) {
  const principal = await getPrincipalFromRequest(request);
  if (!principal) return unauthorized();
  if (principal.kind !== "agent") {
    return Response.json(
      { error: "This endpoint is for agents" },
      { status: 403 }
    );
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
