import { getPrincipalFromRequest } from "@/features/auth/server/agent-auth";
import {
  getSessionFromRequest,
  unauthorized,
} from "@/features/auth/server/session";
import { authzErrorResponse } from "@/features/workspaces/server/authz";
import { ATTACHMENT_MAX_BYTES } from "../types";
import {
  createAttachment,
  deleteAttachment,
  listAttachments,
  openAttachment,
} from "./repository";

function badRequest(message: string) {
  return Response.json({ error: message }, { status: 400 });
}

/**
 * Reads are agent-capable (getPrincipalFromRequest): an agent working a task may
 * want to know what is attached, or fetch one. Upload and delete stay human
 * (getSessionFromRequest) — attaching is board work a person does, and the
 * uploaded_by it records is a user id.
 */
export async function handleListAttachments(request: Request, taskId: number) {
  const principal = await getPrincipalFromRequest(request);
  if (!principal) return unauthorized();
  if (!Number.isInteger(taskId)) return badRequest("Invalid task id");
  try {
    return Response.json(await listAttachments(principal, taskId));
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleUploadAttachment(request: Request, taskId: number) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();
  if (!Number.isInteger(taskId)) return badRequest("Invalid task id");

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return badRequest("A file is required");
  if (file.size === 0) return badRequest("The file is empty");
  if (file.size > ATTACHMENT_MAX_BYTES)
    return badRequest(
      `The file is larger than ${Math.floor(ATTACHMENT_MAX_BYTES / (1024 * 1024))} MB`
    );

  try {
    const body = new Uint8Array(await file.arrayBuffer());
    const attachment = await createAttachment(session.user.id, taskId, {
      name: file.name,
      // Browsers omit type for some files; a generic default keeps downloads
      // working rather than sending an empty Content-Type.
      contentType: file.type || "application/octet-stream",
      size: file.size,
      body,
    });
    return Response.json(attachment, { status: 201 });
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleDownloadAttachment(request: Request, id: number) {
  const principal = await getPrincipalFromRequest(request);
  if (!principal) return unauthorized();
  if (!Number.isInteger(id)) return badRequest("Invalid attachment id");

  try {
    const opened = await openAttachment(principal, id);
    if (!opened) return Response.json({ error: "Attachment not found" }, { status: 404 });
    return new Response(opened.stream, {
      headers: {
        "Content-Type": opened.contentType,
        "Content-Length": String(opened.size),
        // attachment; filename — the browser saves it under its original name.
        // The name is quoted and quotes stripped, so a crafted name cannot inject
        // a second header directive.
        "Content-Disposition": `attachment; filename="${opened.name.replace(/"/g, "")}"`,
      },
    });
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleDeleteAttachment(request: Request, id: number) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();
  if (!Number.isInteger(id)) return badRequest("Invalid attachment id");
  try {
    return (await deleteAttachment(session.user.id, id))
      ? new Response(null, { status: 204 })
      : Response.json({ error: "Attachment not found" }, { status: 404 });
  } catch (error) {
    return authzErrorResponse(error);
  }
}
