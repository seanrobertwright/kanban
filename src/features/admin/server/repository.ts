import { query, queryOne } from "@/shared/db/client";
import { AuthzError, requireWorkspaceRole } from "@/features/workspaces/server/authz";
import { normalizeCidr } from "./ip";
import type { AdminSummary, AuditEvent, CustomFieldPolicy, IpAllowlistEntry, PermissionGrant } from "../types";

export async function listBoardGrants(userId: string, workspaceId: string): Promise<PermissionGrant[]> {
  await requireWorkspaceRole(userId, workspaceId, "admin");
  return query<PermissionGrant>(`SELECT id::text,workspace_id AS "workspaceId",subject_type AS "subjectType",subject_id AS "subjectId",principal_type AS "principalType",principal_id AS "principalId",capability,created_at AS "createdAt" FROM permission_grant WHERE workspace_id=$1 AND subject_type='board' ORDER BY id`, [workspaceId]);
}
export async function grantBoardPermission(userId: string, workspaceId: string, input: Omit<PermissionGrant,"id"|"workspaceId"|"createdAt"|"subjectType">): Promise<PermissionGrant> {
  await requireWorkspaceRole(userId, workspaceId, "admin");
  if (!/^[1-9]\d*$/.test(input.subjectId) || !["user","workspace_role"].includes(input.principalType) || !["read","write","manage"].includes(input.capability)) throw new AuthzError("conflict", "Invalid board permission grant");
  const board = await queryOne<{id:number}>(`SELECT id FROM board WHERE id=$1 AND workspace_id=$2`,[Number(input.subjectId),workspaceId]); if (!board) throw new AuthzError("not_found","Board not found");
  if (input.principalType === "workspace_role" && !["guest","viewer","member","admin","owner"].includes(input.principalId)) throw new AuthzError("conflict","Invalid workspace role");
  if (input.principalType === "user") { const member=await queryOne<{id:string}>(`SELECT user_id AS id FROM workspace_member WHERE workspace_id=$1 AND user_id=$2`,[workspaceId,input.principalId]); if (!member) throw new AuthzError("not_found","Member not found"); }
  return (await queryOne<PermissionGrant>(`INSERT INTO permission_grant(workspace_id,subject_type,subject_id,principal_type,principal_id,capability) VALUES($1,'board',$2,$3,$4,$5) ON CONFLICT(workspace_id,subject_type,subject_id,principal_type,principal_id,capability) DO UPDATE SET capability=EXCLUDED.capability RETURNING id::text,workspace_id AS "workspaceId",subject_type AS "subjectType",subject_id AS "subjectId",principal_type AS "principalType",principal_id AS "principalId",capability,created_at AS "createdAt"`,[workspaceId,input.subjectId,input.principalType,input.principalId,input.capability]))!;
}
export async function revokeBoardGrant(userId:string,workspaceId:string,id:string){await requireWorkspaceRole(userId,workspaceId,"admin");const row=await queryOne<{id:string}>(`DELETE FROM permission_grant WHERE id=$1::bigint AND workspace_id=$2 AND subject_type='board' RETURNING id::text`,[id,workspaceId]);if(!row)throw new AuthzError("not_found","Permission grant not found");}
export async function grantScopedPermission(userId:string,workspaceId:string,input:{subjectType:"custom_field"|"action";subjectId:string;principalType:"user"|"workspace_role";principalId:string;capability:"view"|"edit"|"execute"}){
  await requireWorkspaceRole(userId,workspaceId,"admin");
  if(!input.subjectId.trim()||!input.principalId.trim()||!['user','workspace_role'].includes(input.principalType))throw new AuthzError("conflict","Invalid permission grant");
  if(input.subjectType==='action' && (input.subjectId!=='automation.manage'||input.capability!=='execute'))throw new AuthzError("conflict","Invalid action permission grant");
  if(input.subjectType==='custom_field' && !['view','edit'].includes(input.capability))throw new AuthzError("conflict","Invalid custom-field permission grant");
  if(input.subjectType==="custom_field"){const field=await queryOne<{id:number}>(`SELECT cf.id FROM custom_field cf JOIN board b ON b.id=cf.board_id WHERE cf.id=$1::int AND b.workspace_id=$2`,[input.subjectId,workspaceId]);if(!field)throw new AuthzError("not_found","Custom field not found");}
  if(input.principalType==='workspace_role'&&!['guest','viewer','member','admin','owner'].includes(input.principalId))throw new AuthzError("conflict","Invalid workspace role");
  if(input.principalType==='user'){const member=await queryOne<{id:string}>(`SELECT user_id AS id FROM workspace_member WHERE workspace_id=$1 AND user_id=$2`,[workspaceId,input.principalId]);if(!member)throw new AuthzError("not_found","Member not found");}
  return queryOne(`INSERT INTO permission_grant(workspace_id,subject_type,subject_id,principal_type,principal_id,capability) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING id::text`,[workspaceId,input.subjectType,input.subjectId,input.principalType,input.principalId,input.capability]);
}
export async function setCustomFieldPolicy(userId:string,workspaceId:string,fieldId:number,role:string,canView:boolean,canEdit:boolean){
  await requireWorkspaceRole(userId,workspaceId,"admin");
  if(!["guest","viewer","member","admin","owner"].includes(role)||canEdit&&!canView)throw new AuthzError("conflict","Invalid field access policy");
  const field=await queryOne<{id:number}>(`SELECT cf.id FROM custom_field cf JOIN board b ON b.id=cf.board_id WHERE cf.id=$1 AND b.workspace_id=$2`,[fieldId,workspaceId]);if(!field)throw new AuthzError("not_found","Custom field not found");
  return queryOne(`INSERT INTO custom_field_access_policy(field_id,role,can_view,can_edit) VALUES($1,$2,$3,$4) ON CONFLICT(field_id,role) DO UPDATE SET can_view=EXCLUDED.can_view,can_edit=EXCLUDED.can_edit RETURNING field_id AS "fieldId",role,can_view AS "canView",can_edit AS "canEdit"`,[fieldId,role,canView,canEdit]);
}
export async function listCustomFieldPolicies(userId:string,workspaceId:string):Promise<CustomFieldPolicy[]>{
  await requireWorkspaceRole(userId,workspaceId,"admin");
  return query<CustomFieldPolicy>(`SELECT p.field_id AS "fieldId",cf.name AS "fieldName",cf.board_id AS "boardId",p.role,p.can_view AS "canView",p.can_edit AS "canEdit" FROM custom_field_access_policy p JOIN custom_field cf ON cf.id=p.field_id JOIN board b ON b.id=cf.board_id WHERE b.workspace_id=$1 ORDER BY cf.board_id,cf.position,p.role`,[workspaceId]);
}
export async function deleteCustomFieldPolicy(userId:string,workspaceId:string,fieldId:number,role:string):Promise<void>{
  await requireWorkspaceRole(userId,workspaceId,"admin");
  const row=await queryOne<{fieldId:number}>(`DELETE FROM custom_field_access_policy p USING custom_field cf,board b WHERE p.field_id=cf.id AND b.id=cf.board_id AND b.workspace_id=$1 AND p.field_id=$2 AND p.role=$3 RETURNING p.field_id AS "fieldId"`,[workspaceId,fieldId,role]);
  if(!row)throw new AuthzError("not_found","Field access policy not found");
}

/** The audit-log viewer's read path: recent workspace-wide activity rows,
 * newest first, admin-gated like the summary the count came from. The user
 * join names a human actor when the account still exists; agent actors keep
 * their id (the agents dialog is where those are named). */
export async function listAuditEvents(userId: string, workspaceId: string, limit: number, offset: number): Promise<AuditEvent[]> {
  await requireWorkspaceRole(userId, workspaceId, "admin");
  return query<AuditEvent>(
    `SELECT a.id::text, a.board_id AS "boardId", a.task_id AS "taskId", a.actor_type AS "actorType", a.actor_id AS "actorId", u.name AS "actorName", a.action, a.created_at AS "createdAt"
       FROM activity_log a LEFT JOIN "user" u ON a.actor_type='human' AND u.id=a.actor_id
      WHERE a.workspace_id=$1 ORDER BY a.id DESC LIMIT $2 OFFSET $3`,
    [workspaceId, Math.min(Math.max(limit, 1), 100), Math.max(offset, 0)]
  );
}

/** One admin-gated overview query. The console deliberately reports counts,
 * not sensitive records: it is a navigation and health surface, while the
 * existing focused tools remain the place to manage each resource. */
export async function getAdminSummary(userId: string, workspaceId: string): Promise<AdminSummary> {
  await requireWorkspaceRole(userId, workspaceId, "admin");
  return (await queryOne<AdminSummary>(
    `SELECT
       (SELECT count(*)::int FROM workspace_member WHERE workspace_id=$1) AS members,
       (SELECT count(*)::int FROM agent WHERE workspace_id=$1) AS agents,
       (SELECT count(*)::int FROM board WHERE workspace_id=$1) AS boards,
       (SELECT count(*)::int FROM workspace_webhook WHERE workspace_id=$1 AND active) AS webhooks,
       (SELECT count(*)::int FROM activity_log WHERE workspace_id=$1) AS "auditEvents"`,
    [workspaceId]
  ))!;
}

export async function listIpAllowlist(userId: string, workspaceId: string): Promise<IpAllowlistEntry[]> {
  await requireWorkspaceRole(userId, workspaceId, "admin");
  return query<IpAllowlistEntry>(`SELECT id, cidr, label, created_at AS "createdAt" FROM ip_allowlist WHERE workspace_id=$1 ORDER BY id`, [workspaceId]);
}

export async function addIpAllowlistEntry(userId: string, workspaceId: string, cidr: string, label: string): Promise<IpAllowlistEntry> {
  await requireWorkspaceRole(userId, workspaceId, "owner");
  const normalized = normalizeCidr(cidr);
  if (!normalized) throw new AuthzError("conflict", "Enter a valid IPv4 CIDR, such as 203.0.113.0/24.");
  return (await queryOne<IpAllowlistEntry>(
    `INSERT INTO ip_allowlist(workspace_id, cidr, label) VALUES($1,$2,$3)
     ON CONFLICT(workspace_id,cidr) DO UPDATE SET label=EXCLUDED.label
     RETURNING id,cidr,label,created_at AS "createdAt"`,
    [workspaceId, normalized, label.trim().slice(0, 80)]
  ))!;
}

export async function deleteIpAllowlistEntry(userId: string, workspaceId: string, id: number): Promise<void> {
  await requireWorkspaceRole(userId, workspaceId, "owner");
  const deleted = await queryOne<{ id: number }>(`DELETE FROM ip_allowlist WHERE id=$1 AND workspace_id=$2 RETURNING id`, [id, workspaceId]);
  if (!deleted) throw new AuthzError("not_found", "IP allowlist entry not found");
}
