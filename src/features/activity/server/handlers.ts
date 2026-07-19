import { getPrincipalFromRequest } from "@/features/auth/server/agent-auth";
import {
  getSessionFromRequest,
  unauthorized,
} from "@/features/auth/server/session";
import { authzErrorResponse } from "@/features/workspaces/server/authz";
import {
  listActivityForTask,
  listWorkspaceNotifications,
  markNotificationsSeen,
} from "./repository";

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

// Human-only, unlike the task feed above: the notification bell is a person's
// inbox. An agent has no bell — it reads the board it acts on, it does not get
// pinged about it.
export async function handleListNotifications(
  request: Request,
  workspaceId: string
) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();
  try {
    return Response.json(
      await listWorkspaceNotifications(session.user.id, workspaceId)
    );
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleMarkNotificationsSeen(
  request: Request,
  workspaceId: string
) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();
  try {
    const lastSeenAt = await markNotificationsSeen(
      session.user.id,
      workspaceId
    );
    return Response.json({ lastSeenAt });
  } catch (error) {
    return authzErrorResponse(error);
  }
}
