import { query, queryOne } from "@/shared/db/client";
import { AuthzError, requireWorkspaceRole } from "@/features/workspaces/server/authz";
import type { LegalHoldSubject } from "./legal-holds";

export type RetentionSubject = "activity_log" | "task" | "comment" | "attachment" | "doc";
export type HoldSubject = LegalHoldSubject;
const retentionSubjects = new Set<RetentionSubject>(["activity_log", "task", "comment", "attachment", "doc"]);
const holdSubjects = new Set<HoldSubject>(["task", "comment", "attachment", "doc"]);

export async function listRetentionPolicies(userId: string, workspaceId: string) {
  await requireWorkspaceRole(userId, workspaceId, "admin");
  return query<{id:number;subjectType:RetentionSubject;maxAgeDays:number}>(`SELECT id,subject_type AS "subjectType",max_age_days AS "maxAgeDays" FROM retention_policy WHERE workspace_id=$1 ORDER BY subject_type`,[workspaceId]);
}
export async function saveRetentionPolicy(userId:string,workspaceId:string,subjectType:RetentionSubject,maxAgeDays:number){
  await requireWorkspaceRole(userId,workspaceId,"owner"); if(!retentionSubjects.has(subjectType)||!Number.isInteger(maxAgeDays)||maxAgeDays<1||maxAgeDays>36500)throw new AuthzError("conflict","Invalid retention policy");
  return queryOne(`INSERT INTO retention_policy(workspace_id,subject_type,max_age_days) VALUES($1,$2,$3) ON CONFLICT(workspace_id,subject_type) DO UPDATE SET max_age_days=EXCLUDED.max_age_days,updated_at=now() RETURNING id,subject_type AS "subjectType",max_age_days AS "maxAgeDays"`,[workspaceId,subjectType,maxAgeDays]);
}
export async function placeLegalHold(userId:string,workspaceId:string,subjectType:HoldSubject,subjectId:string,reason:string){
  await requireWorkspaceRole(userId,workspaceId,"admin"); if(!holdSubjects.has(subjectType)||!subjectId.trim()||!reason.trim())throw new AuthzError("conflict","Invalid legal hold");
  const id = Number(subjectId);
  if (!Number.isSafeInteger(id) || id < 1) throw new AuthzError("conflict", "Invalid legal-hold record id");
  const table = subjectType === "doc" ? "doc" : subjectType;
  const subject = await queryOne<{ id: number }>(
    subjectType === "doc"
      ? `SELECT id FROM doc WHERE id=$1 AND workspace_id=$2`
      : subjectType === "task"
        // task reaches its board through board_column; there is no task.board_id.
        ? `SELECT t.id FROM task t JOIN board_column bc ON bc.id=t.column_id JOIN board b ON b.id=bc.board_id WHERE t.id=$1 AND b.workspace_id=$2`
        : subjectType === "comment"
          ? `SELECT c.id FROM comment c JOIN task t ON t.id=c.task_id JOIN board_column bc ON bc.id=t.column_id JOIN board b ON b.id=bc.board_id WHERE c.id=$1 AND b.workspace_id=$2`
          : `SELECT a.id FROM attachment a JOIN task t ON t.id=a.task_id JOIN board_column bc ON bc.id=t.column_id JOIN board b ON b.id=bc.board_id WHERE a.id=$1 AND b.workspace_id=$2`,
    [id, workspaceId]
  );
  if (!subject) throw new AuthzError("not_found", `Held ${table} not found`);
  return queryOne(`INSERT INTO legal_hold(workspace_id,subject_type,subject_id,reason,created_by) VALUES($1,$2,$3,$4,$5) ON CONFLICT(workspace_id,subject_type,subject_id) DO UPDATE SET reason=EXCLUDED.reason,released_at=NULL,released_by=NULL RETURNING id::text`,[workspaceId,subjectType,subjectId,reason.trim().slice(0,1000),userId]);
}
export async function listLegalHolds(userId:string,workspaceId:string){await requireWorkspaceRole(userId,workspaceId,"admin");return query<{id:string;subjectType:HoldSubject;subjectId:string;reason:string;createdAt:string}>(`SELECT id::text,subject_type AS "subjectType",subject_id AS "subjectId",reason,created_at AS "createdAt" FROM legal_hold WHERE workspace_id=$1 AND released_at IS NULL ORDER BY created_at DESC`,[workspaceId]);}
export async function releaseLegalHold(userId:string,workspaceId:string,id:string){await requireWorkspaceRole(userId,workspaceId,"admin");const row=await queryOne<{id:string}>(`UPDATE legal_hold SET released_at=now(),released_by=$3 WHERE id=$1::bigint AND workspace_id=$2 AND released_at IS NULL RETURNING id::text`,[id,workspaceId,userId]);if(!row)throw new AuthzError("not_found","Active legal hold not found");}
