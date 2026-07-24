import { getSessionFromRequest, unauthorized } from "@/features/auth/server/session";
import { authzErrorResponse } from "@/features/workspaces/server/authz";
import { addIpAllowlistEntry, deleteIpAllowlistEntry, getAdminSummary, grantBoardPermission, grantScopedPermission, listBoardGrants, listIpAllowlist, revokeBoardGrant } from "./repository";
import { listLegalHolds, listRetentionPolicies, placeLegalHold, releaseLegalHold, saveRetentionPolicy } from "./retention";
import { generateScimToken, listIdentityProviders, registerIdentityProvider, removeIdentityProvider } from "./identity";
import { exportDiscovery, searchWorkspace } from "./ediscovery";

const bad = (error: string) => Response.json({ error }, { status: 400 });

export async function summary(request: Request, workspaceId: string) {
  const session = await getSessionFromRequest(request); if (!session) return unauthorized();
  try { return Response.json(await getAdminSummary(session.user.id, workspaceId)); } catch (error) { return authzErrorResponse(error); }
}
export async function listGrants(request: Request, workspaceId: string) {
  const session = await getSessionFromRequest(request); if (!session) return unauthorized();
  try { return Response.json(await listBoardGrants(session.user.id, workspaceId)); } catch (error) { return authzErrorResponse(error); }
}
export async function grantBoard(request: Request, workspaceId: string) {
  const session = await getSessionFromRequest(request); if (!session) return unauthorized();
  const body = await request.json().catch(() => null);
  if (!body || typeof body.subjectId !== "string" || typeof body.principalType !== "string" || typeof body.principalId !== "string" || typeof body.capability !== "string") return bad("Invalid board permission grant");
  try {
    const granted = body.subjectType === "action" || body.subjectType === "custom_field"
      ? await grantScopedPermission(session.user.id, workspaceId, body)
      : await grantBoardPermission(session.user.id, workspaceId, body);
    return Response.json(granted, { status: 201 });
  } catch (error) { return authzErrorResponse(error); }
}
export async function revokeGrant(request: Request, workspaceId: string, id: string) {
  const session = await getSessionFromRequest(request); if (!session) return unauthorized();
  if (!/^\d+$/.test(id)) return bad("Invalid permission grant id");
  try { await revokeBoardGrant(session.user.id, workspaceId, id); return new Response(null, { status: 204 }); } catch (error) { return authzErrorResponse(error); }
}
export async function listRetention(request:Request,workspaceId:string){const s=await getSessionFromRequest(request);if(!s)return unauthorized();try{return Response.json(await listRetentionPolicies(s.user.id,workspaceId));}catch(e){return authzErrorResponse(e);}}
export async function saveRetention(request:Request,workspaceId:string){const s=await getSessionFromRequest(request);if(!s)return unauthorized();const b=await request.json().catch(()=>null);if(!b||typeof b.subjectType!=="string"||typeof b.maxAgeDays!=="number")return bad("Invalid retention policy");try{return Response.json(await saveRetentionPolicy(s.user.id,workspaceId,b.subjectType,b.maxAgeDays));}catch(e){return authzErrorResponse(e);}}
export async function hold(request:Request,workspaceId:string){const s=await getSessionFromRequest(request);if(!s)return unauthorized();const b=await request.json().catch(()=>null);if(!b||typeof b.subjectType!=="string"||typeof b.subjectId!=="string"||typeof b.reason!=="string")return bad("Invalid legal hold");try{return Response.json(await placeLegalHold(s.user.id,workspaceId,b.subjectType,b.subjectId,b.reason),{status:201});}catch(e){return authzErrorResponse(e);}}
export async function holds(request:Request,workspaceId:string){const s=await getSessionFromRequest(request);if(!s)return unauthorized();try{return Response.json(await listLegalHolds(s.user.id,workspaceId));}catch(e){return authzErrorResponse(e);}}
export async function releaseHold(request:Request,workspaceId:string,id:string){const s=await getSessionFromRequest(request);if(!s)return unauthorized();if(!/^\d+$/.test(id))return bad("Invalid legal hold id");try{await releaseLegalHold(s.user.id,workspaceId,id);return new Response(null,{status:204});}catch(e){return authzErrorResponse(e);}}
export async function listProviders(request:Request,workspaceId:string){const s=await getSessionFromRequest(request);if(!s)return unauthorized();try{return Response.json(await listIdentityProviders(s.user.id,workspaceId));}catch(e){return authzErrorResponse(e);}}
export async function registerProvider(request:Request,workspaceId:string){const s=await getSessionFromRequest(request);if(!s)return unauthorized();const b=await request.json().catch(()=>null);if(!b||typeof b!=="object")return bad("Invalid identity provider");try{await registerIdentityProvider(s.user.id,workspaceId,b as Record<string,unknown>,request.headers);return new Response(null,{status:201});}catch(e){return authzErrorResponse(e);}}
export async function removeProvider(request:Request,workspaceId:string,providerId:string){const s=await getSessionFromRequest(request);if(!s)return unauthorized();try{await removeIdentityProvider(s.user.id,workspaceId,providerId,request.headers);return new Response(null,{status:204});}catch(e){return authzErrorResponse(e);}}
export async function scimToken(request:Request,workspaceId:string,providerId:string){const s=await getSessionFromRequest(request);if(!s)return unauthorized();try{return Response.json(await generateScimToken(s.user.id,workspaceId,providerId,request.headers),{status:201});}catch(e){return authzErrorResponse(e);}}
export async function discover(request:Request,workspaceId:string){const s=await getSessionFromRequest(request);if(!s)return unauthorized();const term=new URL(request.url).searchParams.get("q")??"";try{return Response.json(await searchWorkspace(s.user.id,workspaceId,term));}catch(e){return authzErrorResponse(e);}}
export async function exportDiscover(request:Request,workspaceId:string){const s=await getSessionFromRequest(request);if(!s)return unauthorized();const term=new URL(request.url).searchParams.get("q")??"";try{return Response.json(await exportDiscovery(s.user.id,workspaceId,term),{headers:{"Content-Disposition":"attachment; filename=ediscovery.json"}});}catch(e){return authzErrorResponse(e);}}

export async function listIps(request: Request, workspaceId: string) {
  const session = await getSessionFromRequest(request); if (!session) return unauthorized();
  try { return Response.json(await listIpAllowlist(session.user.id, workspaceId)); } catch (error) { return authzErrorResponse(error); }
}
export async function addIp(request: Request, workspaceId: string) {
  const session = await getSessionFromRequest(request); if (!session) return unauthorized();
  const body = await request.json().catch(() => null);
  if (!body || typeof body.cidr !== "string" || typeof body.label !== "string") return bad("cidr and label are required");
  try { return Response.json(await addIpAllowlistEntry(session.user.id, workspaceId, body.cidr, body.label), { status: 201 }); } catch (error) { return authzErrorResponse(error); }
}
export async function removeIp(request: Request, workspaceId: string, id: string) {
  const session = await getSessionFromRequest(request); if (!session) return unauthorized();
  const entryId = Number(id); if (!Number.isInteger(entryId)) return bad("Invalid IP allowlist entry id");
  try { await deleteIpAllowlistEntry(session.user.id, workspaceId, entryId); return new Response(null, { status: 204 }); } catch (error) { return authzErrorResponse(error); }
}
