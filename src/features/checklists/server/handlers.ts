import { getPrincipalFromRequest } from "@/features/auth/server/agent-auth";
import {
  getSessionFromRequest,
  unauthorized,
} from "@/features/auth/server/session";
import { authzErrorResponse } from "@/features/workspaces/server/authz";
import { gated } from "@/features/agents/server/door2";
import { CHECKLIST_CONTENT_MAX } from "../types";
import {
  createChecklistItem,
  deleteChecklistItem,
  listChecklist,
  updateChecklistItem,
} from "./repository";

function badRequest(message: string) {
  return Response.json({ error: message }, { status: 400 });
}

function readContent(value: unknown): string | { error: string } {
  if (typeof value !== "string") return { error: "content is required" };
  const content = value.trim();
  if (!content) return { error: "content is required" };
  if (content.length > CHECKLIST_CONTENT_MAX)
    return { error: `content is at most ${CHECKLIST_CONTENT_MAX} characters` };
  return content;
}

/**
 * A principal, not a session, for the three tools mcp/README advertises
 * (`get_checklist`, `add_checklist_item`, `check_item`): an agent token used to
 * 401 on every one of them, so the door promised work it could not do. Deleting
 * an item stays human-only below — the same line the comments slice draws, where
 * an agent contributes but does not remove.
 */
export async function handleListChecklist(request: Request, taskId: number) {
  const principal = await getPrincipalFromRequest(request);
  if (!principal) return unauthorized();
  if (!Number.isInteger(taskId)) return badRequest("Invalid task id");
  try {
    return Response.json(await listChecklist(principal, taskId));
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleCreateChecklistItem(
  request: Request,
  taskId: number
) {
  const principal = await getPrincipalFromRequest(request);
  if (!principal) return unauthorized();
  if (!Number.isInteger(taskId)) return badRequest("Invalid task id");

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return badRequest("Invalid JSON body");
  const parsed = readContent((body as Record<string, unknown>).content);
  if (typeof parsed !== "string") return badRequest(parsed.error);

  try {
    // Auto-tier by blast radius: a step added to a task's checklist is internally
    // reversible and silent outside the board — the same class as a label.
    return await gated(
      principal,
      {
        tool: "add_checklist_item",
        input: { taskId, content: parsed },
        taskId,
        execute: () =>
          createChecklistItem(principal, taskId, { content: parsed }),
      },
      (item) => Response.json(item, { status: 201 })
    );
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleUpdateChecklistItem(request: Request, id: number) {
  const principal = await getPrincipalFromRequest(request);
  if (!principal) return unauthorized();
  if (!Number.isInteger(id)) return badRequest("Invalid item id");

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return badRequest("Invalid JSON body");
  const { content, done } = body as Record<string, unknown>;

  let parsedContent: string | undefined;
  if (content !== undefined) {
    const result = readContent(content);
    if (typeof result !== "string") return badRequest(result.error);
    parsedContent = result;
  }
  if (done !== undefined && typeof done !== "boolean")
    return badRequest("done must be a boolean");

  try {
    // taskId is null here — the item id is what the route carries, and resolving
    // it to a task just to snapshot it would duplicate requireItemRole's lookup.
    // The action still records; it simply has no before-state of the task.
    return await gated(
      principal,
      {
        tool: "check_item",
        input: { itemId: id, content: parsedContent, done },
        taskId: null,
        execute: () =>
          updateChecklistItem(principal, id, {
            content: parsedContent,
            done: done as boolean | undefined,
          }),
      },
      (item) => Response.json(item)
    );
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleDeleteChecklistItem(request: Request, id: number) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();
  if (!Number.isInteger(id)) return badRequest("Invalid item id");
  try {
    return (await deleteChecklistItem(session.user.id, id))
      ? new Response(null, { status: 204 })
      : Response.json({ error: "Checklist item not found" }, { status: 404 });
  } catch (error) {
    return authzErrorResponse(error);
  }
}
