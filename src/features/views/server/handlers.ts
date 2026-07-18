import type { BoardFilter } from "@/features/board/components/board-filter-bar";
import {
  getSessionFromRequest,
  unauthorized,
} from "@/features/auth/server/session";
import { isTaskPriority } from "@/features/tasks/types";
import { authzErrorResponse } from "@/features/workspaces/server/authz";
import {
  SAVED_VIEW_NAME_MAX,
  isBoardViewMode,
  type BoardViewMode,
} from "../types";
import {
  createSavedView,
  deleteSavedView,
  listSavedViews,
} from "./repository";

function badRequest(message: string) {
  return Response.json({ error: message }, { status: 400 });
}

function readName(value: unknown): string | { error: string } {
  if (typeof value !== "string") return { error: "name is required" };
  const name = value.trim();
  if (!name) return { error: "name is required" };
  if (name.length > SAVED_VIEW_NAME_MAX)
    return { error: `name is at most ${SAVED_VIEW_NAME_MAX} characters` };
  return name;
}

/**
 * The filter is stored verbatim as JSONB, so its shape is the API's to police —
 * a malformed one saved now is a broken board render later. Validate every facet
 * to exactly the BoardFilter contract rather than trusting the client.
 */
function readFilter(value: unknown): BoardFilter | { error: string } {
  if (!value || typeof value !== "object") return { error: "filter is required" };
  const f = value as Record<string, unknown>;
  if (typeof f.text !== "string") return { error: "filter.text must be a string" };
  if (
    !Array.isArray(f.priorities) ||
    !f.priorities.every((p) => isTaskPriority(p))
  ) {
    return { error: "filter.priorities must be an array of priorities" };
  }
  if (
    !Array.isArray(f.labelIds) ||
    !f.labelIds.every((id) => Number.isInteger(id))
  ) {
    return { error: "filter.labelIds must be an array of integers" };
  }
  if (
    !Array.isArray(f.assignees) ||
    !f.assignees.every((a) => typeof a === "string")
  ) {
    return { error: "filter.assignees must be an array of strings" };
  }
  return {
    text: f.text,
    priorities: f.priorities as BoardFilter["priorities"],
    labelIds: f.labelIds as number[],
    assignees: f.assignees as string[],
  };
}

export async function handleListSavedViews(
  request: Request,
  workspaceId: string
) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();
  try {
    return Response.json(await listSavedViews(session.user.id, workspaceId));
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleCreateSavedView(
  request: Request,
  workspaceId: string
) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return badRequest("Invalid JSON body");
  const { name, viewMode, filter } = body as Record<string, unknown>;

  const parsedName = readName(name);
  if (typeof parsedName !== "string") return badRequest(parsedName.error);
  if (!isBoardViewMode(viewMode))
    return badRequest("viewMode must be board, list, or calendar");
  const parsedFilter = readFilter(filter);
  if ("error" in parsedFilter) return badRequest(parsedFilter.error);

  try {
    const view = await createSavedView(session.user.id, workspaceId, {
      name: parsedName,
      viewMode: viewMode as BoardViewMode,
      filter: parsedFilter,
    });
    return Response.json(view, { status: 201 });
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleDeleteSavedView(request: Request, id: number) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();
  if (!Number.isInteger(id)) return badRequest("Invalid view id");

  try {
    return (await deleteSavedView(session.user.id, id))
      ? new Response(null, { status: 204 })
      : Response.json({ error: "Saved view not found" }, { status: 404 });
  } catch (error) {
    return authzErrorResponse(error);
  }
}
