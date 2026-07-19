import { getPrincipalFromRequest } from "@/features/auth/server/agent-auth";
import {
  getSessionFromRequest,
  unauthorized,
} from "@/features/auth/server/session";
import { authzErrorResponse } from "@/features/workspaces/server/authz";
import { PRIORITY_ORDER, isTaskPriority } from "@/features/tasks/types";
import type { TaskPriority } from "@/features/tasks/types";
import { TEMPLATE_TITLE_MAX } from "../types";
import {
  createTemplate,
  deleteTemplate,
  listTemplates,
  updateTemplate,
} from "./repository";

function badRequest(message: string) {
  return Response.json({ error: message }, { status: 400 });
}

function readTitle(value: unknown): string | { error: string } {
  if (typeof value !== "string") return { error: "title is required" };
  const title = value.trim();
  if (!title) return { error: "title is required" };
  if (title.length > TEMPLATE_TITLE_MAX)
    return { error: `title is at most ${TEMPLATE_TITLE_MAX} characters` };
  return title;
}

/** Two-valued, like the task's labelIds: [] is the empty set, so null is not a
 * legal "clear" and is rejected here rather than honoured. */
function isLabelIds(value: unknown): value is number[] | undefined {
  return (
    value === undefined ||
    (Array.isArray(value) && value.every((v) => Number.isInteger(v)))
  );
}

/**
 * getPrincipalFromRequest for the read, getSessionFromRequest for the writes —
 * listLabels' split exactly. An agent needs to read a template to instantiate one
 * (it has createTask); minting and editing shared config is human administration,
 * not board work an agent does.
 */
export async function handleListTemplates(
  request: Request,
  workspaceId: string
) {
  const principal = await getPrincipalFromRequest(request);
  if (!principal) return unauthorized();
  try {
    return Response.json(await listTemplates(principal, workspaceId));
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleCreateTemplate(
  request: Request,
  workspaceId: string
) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return badRequest("Invalid JSON body");

  const { title, description, priority, labelIds } = body as Record<
    string,
    unknown
  >;
  const parsedTitle = readTitle(title);
  if (typeof parsedTitle !== "string") return badRequest(parsedTitle.error);
  if (description !== undefined && typeof description !== "string")
    return badRequest("description must be a string");
  if (priority !== undefined && !isTaskPriority(priority))
    return badRequest(`priority must be one of: ${PRIORITY_ORDER.join(", ")}`);
  if (!isLabelIds(labelIds))
    return badRequest("labelIds must be an array of label ids");

  try {
    const template = await createTemplate(session.user.id, workspaceId, {
      title: parsedTitle,
      description: description as string | undefined,
      priority: priority as TaskPriority | undefined,
      labelIds: labelIds as number[] | undefined,
    });
    return Response.json(template, { status: 201 });
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleUpdateTemplate(request: Request, id: number) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();
  if (!Number.isInteger(id)) return badRequest("Invalid template id");

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return badRequest("Invalid JSON body");

  const { title, description, priority, labelIds } = body as Record<
    string,
    unknown
  >;
  let parsedTitle: string | undefined;
  if (title !== undefined) {
    const result = readTitle(title);
    if (typeof result !== "string") return badRequest(result.error);
    parsedTitle = result;
  }
  if (description !== undefined && typeof description !== "string")
    return badRequest("description must be a string");
  if (priority !== undefined && !isTaskPriority(priority))
    return badRequest(`priority must be one of: ${PRIORITY_ORDER.join(", ")}`);
  if (!isLabelIds(labelIds))
    return badRequest("labelIds must be an array of label ids");

  try {
    return Response.json(
      await updateTemplate(session.user.id, id, {
        title: parsedTitle,
        description: description as string | undefined,
        priority: priority as TaskPriority | undefined,
        labelIds: labelIds as number[] | undefined,
      })
    );
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleDeleteTemplate(request: Request, id: number) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();
  if (!Number.isInteger(id)) return badRequest("Invalid template id");
  try {
    return (await deleteTemplate(session.user.id, id))
      ? new Response(null, { status: 204 })
      : Response.json({ error: "Template not found" }, { status: 404 });
  } catch (error) {
    return authzErrorResponse(error);
  }
}
