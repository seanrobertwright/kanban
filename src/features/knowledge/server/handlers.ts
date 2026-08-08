import { getPrincipalFromRequest } from "@/features/auth/server/agent-auth";
import { unauthorized } from "@/features/auth/server/session";
import { authzErrorResponse } from "@/features/workspaces/server/authz";
import { askWorkspaceKnowledge } from "./repository";

// Any credential that resolves to a HUMAN principal: a cookie session or a
// personal API key, which is how the CLI asks the knowledge base. Agent keys
// still get 401 — the MCP door's knowledge_query documents that limitation.
export async function handleKnowledgeQuery(request: Request, workspaceId: string) {
  const principal = await getPrincipalFromRequest(request);
  if (principal?.kind !== "human") return unauthorized();
  const payload = await request.json().catch(() => null);
  const question = payload && typeof payload.question === "string" ? payload.question.trim() : "";
  if (!question || question.length > 500) {
    return Response.json({ error: "question must be between 1 and 500 characters" }, { status: 400 });
  }
  try {
    return Response.json(await askWorkspaceKnowledge(principal.userId, workspaceId, question));
  } catch (error) {
    return authzErrorResponse(error);
  }
}
