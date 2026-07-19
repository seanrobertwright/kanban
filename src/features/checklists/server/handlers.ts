import {
  getSessionFromRequest,
  unauthorized,
} from "@/features/auth/server/session";
import { authzErrorResponse } from "@/features/workspaces/server/authz";
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

export async function handleListChecklist(request: Request, taskId: number) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();
  if (!Number.isInteger(taskId)) return badRequest("Invalid task id");
  try {
    return Response.json(await listChecklist(session.user.id, taskId));
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleCreateChecklistItem(
  request: Request,
  taskId: number
) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();
  if (!Number.isInteger(taskId)) return badRequest("Invalid task id");

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return badRequest("Invalid JSON body");
  const parsed = readContent((body as Record<string, unknown>).content);
  if (typeof parsed !== "string") return badRequest(parsed.error);

  try {
    const item = await createChecklistItem(session.user.id, taskId, {
      content: parsed,
    });
    return Response.json(item, { status: 201 });
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleUpdateChecklistItem(request: Request, id: number) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();
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
    return Response.json(
      await updateChecklistItem(session.user.id, id, {
        content: parsedContent,
        done: done as boolean | undefined,
      })
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
