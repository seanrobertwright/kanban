import { getPrincipalFromRequest } from "@/features/auth/server/agent-auth";
import { unauthorized } from "@/features/auth/server/session";
import { authzErrorResponse } from "@/features/workspaces/server/authz";
import { isTaskPriority } from "@/features/tasks/types";
import { listRequests, triageRequest } from "./repository";
import type { TriageRequestInput } from "../types";

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

/**
 * PATCH one request: the triage verdict. The body is parsed into the narrow
 * TriageRequestInput union here rather than trusted through — an unknown action
 * is a 400, not a silent no-op, and the accept fields are read one at a time so
 * a stray `{action:'accept', title:'…'}` cannot become a task edit.
 */
export async function handleTriageRequest(
  request: Request,
  id: string,
  taskIdParam: string
) {
  const principal = await getPrincipalFromRequest(request);
  if (!principal) return unauthorized();
  const boardId = Number(id);
  const taskId = Number(taskIdParam);
  if (!Number.isInteger(boardId) || !Number.isInteger(taskId))
    return Response.json({ error: "Invalid id" }, { status: 400 });

  const body = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  const input = parseTriage(body);
  if (!input) return Response.json({ error: "Invalid triage" }, { status: 400 });

  try {
    return Response.json(await triageRequest(principal, boardId, taskId, input));
  } catch (error) {
    return authzErrorResponse(error);
  }
}

function parseTriage(
  body: Record<string, unknown> | null
): TriageRequestInput | null {
  const action = body?.action;
  if (action === "reopen") return { action: "reopen" };
  if (action === "decline") {
    const reason = body?.reason;
    return {
      action: "decline",
      ...(typeof reason === "string" ? { reason } : {}),
    };
  }
  if (action !== "accept") return null;

  const input: Extract<TriageRequestInput, { action: "accept" }> = {
    action: "accept",
  };
  const { columnId, assignee, priority } = body ?? {};
  if (columnId !== undefined) {
    if (!Number.isInteger(columnId)) return null;
    input.columnId = columnId as number;
  }
  // Present-and-null is meaningful (unassign), so this branch keys on the key,
  // not on the value — repository-side three-valued rule, preserved end to end.
  if (body && "assignee" in body) {
    if (assignee === null) input.assignee = null;
    else if (isActor(assignee)) input.assignee = assignee;
    else return null;
  }
  if (priority !== undefined) {
    if (!isTaskPriority(priority)) return null;
    input.priority = priority;
  }
  return input;
}

function isActor(value: unknown): value is { type: "human" | "agent"; id: string } {
  if (!value || typeof value !== "object") return false;
  const { type, id } = value as { type?: unknown; id?: unknown };
  return (type === "human" || type === "agent") && typeof id === "string";
}
