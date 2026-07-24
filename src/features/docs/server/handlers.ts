import { getPrincipalFromRequest } from "@/features/auth/server/agent-auth";
import { getSessionFromRequest, unauthorized } from "@/features/auth/server/session";
import { authzErrorResponse } from "@/features/workspaces/server/authz";
import { DOC_BODY_MAX, DOC_TITLE_MAX, isDocKind, type CreateDocInput, type UpdateDocInput } from "../types";
import { createDoc, deleteDoc, extractActionsFromMeeting, getPublicDoc, issueCollaborationTicket, listDocRevisions, listDocs, promoteMeetingAction, requireSharedDoc, updateDoc } from "./repository";

const bad = (error: string) => Response.json({ error }, { status: 400 });
function readInput(payload: Record<string, unknown>, creating: boolean): CreateDocInput | UpdateDocInput | Response {
  const input: UpdateDocInput = {};
  if (creating || "title" in payload) {
    if (typeof payload.title !== "string" || payload.title.trim() === "") return bad("title is required");
    if (payload.title.trim().length > DOC_TITLE_MAX) return bad(`title must be ${DOC_TITLE_MAX} characters or fewer`);
    input.title = payload.title.trim();
  }
  if ("body" in payload) { if (typeof payload.body !== "string" || payload.body.length > DOC_BODY_MAX) return bad(`body must be a string of ${DOC_BODY_MAX} characters or fewer`); input.body = payload.body; }
  if ("kind" in payload) { if (!isDocKind(payload.kind)) return bad("kind must be page, meeting, or decision"); input.kind = payload.kind; }
  for (const key of ["boardId", "parentId"] as const) if (key in payload) { const value = payload[key]; if (value !== null && !Number.isInteger(value)) return bad(`${key} must be an integer or null`); input[key] = value as number | null; }
  if ("position" in payload) { if (!Number.isInteger(payload.position) || (payload.position as number) < 0) return bad("position must be a non-negative integer"); input.position = payload.position as number; }
  if ("isPublished" in payload) { if (typeof payload.isPublished !== "boolean") return bad("isPublished must be a boolean"); input.isPublished = payload.isPublished; }
  return input;
}
export async function handleListDocs(request: Request, workspaceId: string) { const p = await getPrincipalFromRequest(request); if (!p) return unauthorized(); try { return Response.json(await listDocs(p, workspaceId, new URL(request.url).searchParams.get("q") ?? undefined)); } catch (error) { return authzErrorResponse(error); } }
export async function handleCreateDoc(request: Request, workspaceId: string) { const s = await getSessionFromRequest(request); if (!s) return unauthorized(); const p = await request.json().catch(() => null); if (!p || typeof p !== "object") return bad("Invalid JSON body"); const input = readInput(p as Record<string, unknown>, true); if (input instanceof Response) return input; try { return Response.json(await createDoc(s.user.id, workspaceId, input as CreateDocInput), { status: 201 }); } catch (error) { return authzErrorResponse(error); } }
export async function handleUpdateDoc(request: Request, id: string) { const s = await getSessionFromRequest(request); if (!s) return unauthorized(); const docId = Number(id); if (!Number.isInteger(docId)) return bad("Invalid document id"); const p = await request.json().catch(() => null); if (!p || typeof p !== "object") return bad("Invalid JSON body"); const input = readInput(p as Record<string, unknown>, false); if (input instanceof Response) return input; try { const doc = await updateDoc(s.user.id, docId, input); return doc ? Response.json(doc) : Response.json({ error: "Document not found" }, { status: 404 }); } catch (error) { return authzErrorResponse(error); } }
export async function handleDeleteDoc(request: Request, id: string) { const s = await getSessionFromRequest(request); if (!s) return unauthorized(); const docId = Number(id); if (!Number.isInteger(docId)) return bad("Invalid document id"); try { await deleteDoc(s.user.id, docId); return new Response(null, { status: 204 }); } catch (error) { return authzErrorResponse(error); } }
export async function handleListDocRevisions(request: Request, id: string) { const p = await getPrincipalFromRequest(request); if (!p) return unauthorized(); const docId = Number(id); if (!Number.isInteger(docId)) return bad("Invalid document id"); try { return Response.json(await listDocRevisions(p, docId)); } catch (error) { return authzErrorResponse(error); } }
export async function handleCollaborationTicket(request: Request, id: string) { const s = await getSessionFromRequest(request); if (!s) return unauthorized(); const docId = Number(id); if (!Number.isInteger(docId)) return bad("Invalid document id"); try { return Response.json({ ticket: await issueCollaborationTicket(s.user.id, docId) }); } catch (error) { return authzErrorResponse(error); } }
export async function handleSharedDoc(request: Request, id: string) { const s=await getSessionFromRequest(request); if(!s)return unauthorized(); const docId=Number(id);if(!Number.isInteger(docId))return bad("Invalid document id");try{return Response.json(await requireSharedDoc(s.user.id,docId));}catch(error){return authzErrorResponse(error);}}
export async function handlePublicDoc(_request: Request, token: string) { try { return Response.json(await getPublicDoc(token), { headers: { "Cache-Control": "no-store" } }); } catch (error) { return authzErrorResponse(error); } }
export async function handlePromoteMeetingAction(request:Request,id:string){const s=await getSessionFromRequest(request);if(!s)return unauthorized();const docId=Number(id);const p=await request.json().catch(()=>null);if(!Number.isInteger(docId)||!p||typeof p.title!=="string"||!p.title.trim())return bad("title is required");try{return Response.json(await promoteMeetingAction(s.user.id,docId,p.title),{status:201});}catch(error){return authzErrorResponse(error);}}
export async function handleExtractMeetingActions(request:Request,id:string){const s=await getSessionFromRequest(request);if(!s)return unauthorized();const docId=Number(id);if(!Number.isInteger(docId))return bad("Invalid document id");try{return Response.json(await extractActionsFromMeeting(s.user.id,docId));}catch(error){return authzErrorResponse(error);}}
