import {
  getSessionFromRequest,
  unauthorized,
} from "@/features/auth/server/session";
import { authzErrorResponse } from "@/features/workspaces/server/authz";
import { LABEL_COLORS, LABEL_NAME_MAX, isLabelColor } from "../types";
import {
  createLabel,
  deleteLabel,
  listLabels,
  updateLabel,
} from "./repository";

function badRequest(message: string) {
  return Response.json({ error: message }, { status: 400 });
}

/**
 * Shape is the API's to police, and the trim is not cosmetic here.
 * `lower('bug ')` and `lower('bug')` are different strings, so an untrimmed name
 * walks past the unique index that makes the vocabulary controlled and lands as
 * two labels that render identically — a bug whoever reports it cannot see. The
 * columns handler trims a title for tidiness; this trims for correctness.
 */
function readName(value: unknown): string | { error: string } {
  if (typeof value !== "string") return { error: "name is required" };
  const name = value.trim();
  if (!name) return { error: "name is required" };
  if (name.length > LABEL_NAME_MAX)
    return { error: `name is at most ${LABEL_NAME_MAX} characters` };
  return name;
}

export async function handleListLabels(request: Request, workspaceId: string) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();

  try {
    return Response.json(await listLabels(session.user.id, workspaceId));
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleCreateLabel(request: Request, workspaceId: string) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return badRequest("Invalid JSON body");

  const { name, color } = body as Record<string, unknown>;
  const parsed = readName(name);
  if (typeof parsed !== "string") return badRequest(parsed.error);
  if (color !== undefined && !isLabelColor(color))
    return badRequest(`color must be one of: ${LABEL_COLORS.join(", ")}`);

  try {
    const label = await createLabel(session.user.id, workspaceId, {
      name: parsed,
      color,
    });
    return Response.json(label, { status: 201 });
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleUpdateLabel(request: Request, id: number) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();
  if (!Number.isInteger(id)) return badRequest("Invalid label id");

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return badRequest("Invalid JSON body");

  const { name, color } = body as Record<string, unknown>;
  // Both optional and both two-valued: neither is nullable, so absence is the
  // only way to say "leave it alone" and COALESCE expresses it (006's rule).
  let parsed: string | undefined;
  if (name !== undefined) {
    const result = readName(name);
    if (typeof result !== "string") return badRequest(result.error);
    parsed = result;
  }
  if (color !== undefined && !isLabelColor(color))
    return badRequest(`color must be one of: ${LABEL_COLORS.join(", ")}`);

  try {
    return Response.json(
      await updateLabel(session.user.id, id, { name: parsed, color })
    );
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleDeleteLabel(request: Request, id: number) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();
  if (!Number.isInteger(id)) return badRequest("Invalid label id");

  try {
    return (await deleteLabel(session.user.id, id))
      ? new Response(null, { status: 204 })
      : Response.json({ error: "Label not found" }, { status: 404 });
  } catch (error) {
    return authzErrorResponse(error);
  }
}
