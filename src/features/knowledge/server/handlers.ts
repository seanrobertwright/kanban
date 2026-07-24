import { getSessionFromRequest, unauthorized } from "@/features/auth/server/session";
import { authzErrorResponse } from "@/features/workspaces/server/authz";
import { askWorkspaceKnowledge } from "./repository";

export async function handleKnowledgeQuery(request: Request, workspaceId: string) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();
  const payload = await request.json().catch(() => null);
  const question = payload && typeof payload.question === "string" ? payload.question.trim() : "";
  if (!question || question.length > 500) {
    return Response.json({ error: "question must be between 1 and 500 characters" }, { status: 400 });
  }
  try {
    return Response.json(await askWorkspaceKnowledge(session.user.id, workspaceId, question));
  } catch (error) {
    return authzErrorResponse(error);
  }
}
