import {
  getSessionFromRequest,
  unauthorized,
} from "@/features/auth/server/session";
import { authzErrorResponse } from "@/features/workspaces/server/authz";
import { listActivityForTask } from "./repository";

export async function handleListTaskActivity(request: Request, id: string) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();

  const taskId = Number(id);
  if (!Number.isInteger(taskId)) {
    return Response.json({ error: "Invalid task id" }, { status: 400 });
  }

  try {
    return Response.json(await listActivityForTask(session.user.id, taskId));
  } catch (error) {
    return authzErrorResponse(error);
  }
}
