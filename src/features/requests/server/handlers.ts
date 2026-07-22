import { getPrincipalFromRequest } from "@/features/auth/server/agent-auth";
import { unauthorized } from "@/features/auth/server/session";
import { authzErrorResponse } from "@/features/workspaces/server/authz";
import { listRequests } from "./repository";

export async function handleListRequests(request: Request, id: string) {
  const principal = await getPrincipalFromRequest(request);
  if (!principal) return unauthorized();
  const boardId = Number(id);
  if (!Number.isInteger(boardId))
    return Response.json({ error: "Invalid board id" }, { status: 400 });
  try {
    return Response.json(await listRequests(principal, boardId));
  } catch (error) {
    return authzErrorResponse(error);
  }
}
