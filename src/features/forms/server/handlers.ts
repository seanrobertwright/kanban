import { getPrincipalFromRequest } from "@/features/auth/server/agent-auth";
import {
  getSessionFromRequest,
  unauthorized,
} from "@/features/auth/server/session";
import { authzErrorResponse } from "@/features/workspaces/server/authz";
import {
  FORM_FIELD_LABEL_MAX,
  FORM_MAX_FIELDS,
  FORM_NAME_MAX,
  isFormFieldType,
  type CreateFormInput,
  type FormField,
  type UpdateFormInput,
} from "../types";
import {
  createForm,
  deleteForm,
  FormSubmitError,
  listForms,
  submitForm,
  updateForm,
} from "./repository";

// Reads take a principal (an agent that can read a board can read its forms);
// management and submission take a session — the objectives split.

function badRequest(message: string) {
  return Response.json({ error: message }, { status: 400 });
}

function notFound(what = "Form") {
  return Response.json({ error: `${what} not found` }, { status: 404 });
}

/** Validates a caller-supplied fields array into FormField[], or an error. */
function readFields(v: unknown): FormField[] | { error: string } {
  if (!Array.isArray(v)) return { error: "fields must be an array" };
  if (v.length === 0) return { error: "a form needs at least one question" };
  if (v.length > FORM_MAX_FIELDS)
    return { error: `a form may have at most ${FORM_MAX_FIELDS} questions` };
  const fields: FormField[] = [];
  for (const raw of v) {
    if (!raw || typeof raw !== "object") return { error: "each question must be an object" };
    const { label, type, required } = raw as Record<string, unknown>;
    if (typeof label !== "string" || label.trim() === "")
      return { error: "each question needs a label" };
    if (label.trim().length > FORM_FIELD_LABEL_MAX)
      return { error: `a question label must be ${FORM_FIELD_LABEL_MAX} characters or fewer` };
    if (!isFormFieldType(type))
      return { error: "each question type must be text, textarea, or number" };
    fields.push({ label: label.trim(), type, required: required === true });
  }
  return fields;
}

/** A column id (number) or null; the sentinel `false` on a malformed value. */
function readTargetColumn(
  payload: Record<string, unknown>
): { present: false } | { present: true; value: number | null } | false {
  if (!("targetColumnId" in payload)) return { present: false };
  const v = payload.targetColumnId;
  if (v === null) return { present: true, value: null };
  if (typeof v === "number" && Number.isInteger(v)) return { present: true, value: v };
  return false;
}

export async function handleListForms(request: Request, id: string) {
  const principal = await getPrincipalFromRequest(request);
  if (!principal) return unauthorized();
  const boardId = Number(id);
  if (!Number.isInteger(boardId)) return badRequest("Invalid board id");
  try {
    return Response.json(await listForms(principal, boardId));
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleCreateForm(request: Request, id: string) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();
  const boardId = Number(id);
  if (!Number.isInteger(boardId)) return badRequest("Invalid board id");

  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object") return badRequest("Invalid JSON body");
  const p = payload as Record<string, unknown>;

  if (typeof p.name !== "string" || p.name.trim() === "")
    return badRequest("name is required");
  if (p.name.trim().length > FORM_NAME_MAX)
    return badRequest(`name must be ${FORM_NAME_MAX} characters or fewer`);
  if (p.description !== undefined && typeof p.description !== "string")
    return badRequest("description must be a string");
  const fields = readFields(p.fields);
  if ("error" in fields) return badRequest(fields.error);
  const target = readTargetColumn(p);
  if (target === false) return badRequest("targetColumnId must be an integer or null");
  if (p.isOpen !== undefined && typeof p.isOpen !== "boolean")
    return badRequest("isOpen must be a boolean");

  const input: CreateFormInput = {
    name: p.name.trim(),
    description: p.description as string | undefined,
    fields,
    isOpen: p.isOpen as boolean | undefined,
  };
  if (target.present) input.targetColumnId = target.value;

  try {
    return Response.json(await createForm(session.user.id, boardId, input), {
      status: 201,
    });
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleUpdateForm(request: Request, id: string) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();
  const formId = Number(id);
  if (!Number.isInteger(formId)) return badRequest("Invalid form id");

  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object") return badRequest("Invalid JSON body");
  const p = payload as Record<string, unknown>;

  const input: UpdateFormInput = {};
  if (p.name !== undefined) {
    if (typeof p.name !== "string" || p.name.trim() === "")
      return badRequest("name must be a non-empty string");
    if (p.name.trim().length > FORM_NAME_MAX)
      return badRequest(`name must be ${FORM_NAME_MAX} characters or fewer`);
    input.name = p.name.trim();
  }
  if (p.description !== undefined) {
    if (typeof p.description !== "string") return badRequest("description must be a string");
    input.description = p.description;
  }
  if (p.fields !== undefined) {
    const fields = readFields(p.fields);
    if ("error" in fields) return badRequest(fields.error);
    input.fields = fields;
  }
  const target = readTargetColumn(p);
  if (target === false) return badRequest("targetColumnId must be an integer or null");
  if (target.present) input.targetColumnId = target.value;
  if (p.isOpen !== undefined) {
    if (typeof p.isOpen !== "boolean") return badRequest("isOpen must be a boolean");
    input.isOpen = p.isOpen;
  }

  try {
    const form = await updateForm(session.user.id, formId, input);
    return form ? Response.json(form) : notFound();
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleDeleteForm(request: Request, id: string) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();
  const formId = Number(id);
  if (!Number.isInteger(formId)) return badRequest("Invalid form id");
  try {
    return (await deleteForm(session.user.id, formId))
      ? new Response(null, { status: 204 })
      : notFound();
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleSubmitForm(request: Request, id: string) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();
  const formId = Number(id);
  if (!Number.isInteger(formId)) return badRequest("Invalid form id");

  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object") return badRequest("Invalid JSON body");
  const { answers } = payload as Record<string, unknown>;
  if (!Array.isArray(answers) || answers.some((a) => typeof a !== "string"))
    return badRequest("answers must be an array of strings");

  try {
    const task = await submitForm(session.user.id, formId, {
      answers: answers as string[],
    });
    return Response.json(task, { status: 201 });
  } catch (error) {
    if (error instanceof FormSubmitError) return badRequest(error.message);
    return authzErrorResponse(error);
  }
}
