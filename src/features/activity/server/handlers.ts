import { getPrincipalFromRequest } from "@/features/auth/server/agent-auth";
import { unauthorized } from "@/features/auth/server/session";
import { authzErrorResponse } from "@/features/workspaces/server/authz";
import { listActivityForTask } from "./repository";

// getPrincipalFromRequest, not getSessionFromRequest: a task's history is part of
// the same access path §7.1 says an agent shares with a human, so the MCP door's
// agents read it the way they read the board — an agent that can write to the log
// but not read it back is blind to what it just did. The repository scopes an
// agent to its own workspace, so this widening grants no cross-tenant reach.
export async function handleListTaskActivity(request: Request, id: string) {
  const principal = await getPrincipalFromRequest(request);
  if (!principal) return unauthorized();

  const taskId = Number(id);
  if (!Number.isInteger(taskId)) {
    return Response.json({ error: "Invalid task id" }, { status: 400 });
  }

  try {
    return Response.json(await listActivityForTask(principal, taskId));
  } catch (error) {
    return authzErrorResponse(error);
  }
}
