import { getPrincipalFromRequest } from "@/features/auth/server/agent-auth";
import {
  getSessionFromRequest,
  unauthorized,
} from "@/features/auth/server/session";
import { authzErrorResponse } from "@/features/workspaces/server/authz";
import {
  createField,
  deleteField,
  getTaskFields,
  listBoardFields,
  setTaskFieldValues,
  updateField,
} from "./repository";
import { CUSTOM_FIELD_TYPES, isCustomFieldType } from "../types";

function badRequest(message: string) {
  return Response.json({ error: message }, { status: 400 });
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

// Definitions: reads take a principal (an agent reasoning about a board may read
// its fields); writes take a session — defining a board's shape is a human's job
// in this cut, and values are set by people through the dialog.

export async function handleListBoardFields(request: Request, id: string) {
  const principal = await getPrincipalFromRequest(request);
  if (!principal) return unauthorized();
  const boardId = Number(id);
  if (!Number.isInteger(boardId)) return badRequest("Invalid board id");
  try {
    return Response.json(await listBoardFields(principal, boardId));
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleCreateField(request: Request, id: string) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();
  const boardId = Number(id);
  if (!Number.isInteger(boardId)) return badRequest("Invalid board id");

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return badRequest("Invalid JSON body");
  const { name, type, options } = body as Record<string, unknown>;

  if (typeof name !== "string" || name.trim() === "")
    return badRequest("name is required");
  if (!isCustomFieldType(type))
    return badRequest(`type must be one of: ${CUSTOM_FIELD_TYPES.join(", ")}`);
  if (options !== undefined && !isStringArray(options))
    return badRequest("options must be an array of strings");

  try {
    const field = await createField(session.user.id, boardId, {
      name,
      type,
      options: options as string[] | undefined,
    });
    return Response.json(field, { status: 201 });
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleUpdateField(request: Request, id: string) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();
  const fieldId = Number(id);
  if (!Number.isInteger(fieldId)) return badRequest("Invalid field id");

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return badRequest("Invalid JSON body");
  const { name, options, position } = body as Record<string, unknown>;

  if (name !== undefined && (typeof name !== "string" || name.trim() === ""))
    return badRequest("name must be a non-empty string");
  if (options !== undefined && !isStringArray(options))
    return badRequest("options must be an array of strings");
  if (position !== undefined && !Number.isInteger(position))
    return badRequest("position must be an integer");

  try {
    return Response.json(
      await updateField(session.user.id, fieldId, {
        name: name as string | undefined,
        options: options as string[] | undefined,
        position: position as number | undefined,
      })
    );
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleDeleteField(request: Request, id: string) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();
  const fieldId = Number(id);
  if (!Number.isInteger(fieldId)) return badRequest("Invalid field id");
  try {
    return (await deleteField(session.user.id, fieldId))
      ? new Response(null, { status: 204 })
      : Response.json({ error: "Custom field not found" }, { status: 404 });
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleGetTaskFields(request: Request, id: string) {
  const principal = await getPrincipalFromRequest(request);
  if (!principal) return unauthorized();
  const taskId = Number(id);
  if (!Number.isInteger(taskId)) return badRequest("Invalid task id");
  try {
    return Response.json(await getTaskFields(principal, taskId));
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleSetTaskFields(request: Request, id: string) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();
  const taskId = Number(id);
  if (!Number.isInteger(taskId)) return badRequest("Invalid task id");

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return badRequest("Invalid JSON body");
  const { values } = body as Record<string, unknown>;
  if (
    !Array.isArray(values) ||
    !values.every(
      (v) =>
        v &&
        typeof v === "object" &&
        Number.isInteger((v as Record<string, unknown>).fieldId) &&
        ((v as Record<string, unknown>).value === null ||
          typeof (v as Record<string, unknown>).value === "string")
    )
  )
    return badRequest("values must be an array of { fieldId, value }");

  try {
    return Response.json(
      await setTaskFieldValues(
        session.user.id,
        taskId,
        values as { fieldId: number; value: string | null }[]
      )
    );
  } catch (error) {
    return authzErrorResponse(error);
  }
}
