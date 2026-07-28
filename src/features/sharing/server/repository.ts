import crypto from "node:crypto";
import { query, queryOne } from "@/shared/db/client";
import { AuthzError, requireWorkspaceRole } from "@/features/workspaces/server/authz";
import { submitForm } from "@/features/forms/server/repository";
import type { FormField } from "@/features/forms/types";
import { createFeedback } from "@/features/discovery/server/repository";
import type { FeedbackSentiment } from "@/features/discovery/types";
import type { ObjectShareSubject, ShareSubject } from "../types";
export type { ShareSubject };
async function workspaceFor(subject:ShareSubject,id:string){
  // 'feedback' resolves like a board because that is what its subject_id IS (085):
  // the link is a door into one board's discovery inbox, and there is no feedback
  // row to point at until a visitor has written one. Listed explicitly ahead of
  // the generic branch, which would otherwise read the `feedback` TABLE and
  // silently resolve a different object.
  const sql=subject==="doc"?`SELECT workspace_id AS "workspaceId" FROM doc WHERE id=$1`:subject==="board"||subject==="feedback"?`SELECT workspace_id AS "workspaceId" FROM board WHERE id=$1`:subject==="view"?`SELECT workspace_id AS "workspaceId" FROM saved_view WHERE id=$1`:`SELECT b.workspace_id AS "workspaceId" FROM ${subject} x JOIN board b ON b.id=x.board_id WHERE x.id=$1`;
  const row=await queryOne<{workspaceId:string}>(sql,[id]); if(!row)throw new AuthzError("not_found","Share subject not found"); return row.workspaceId;
}
export async function mintPublicLink(userId:string,subject:ShareSubject,subjectId:string,scope:"read"|"submit",expiresAt?:string|null){const workspaceId=await workspaceFor(subject,subjectId);await requireWorkspaceRole(userId,workspaceId,"admin");const token=crypto.randomBytes(32).toString("base64url");return (await queryOne<{id:number;token:string}>(`INSERT INTO public_link(subject_type,subject_id,token,scope,expires_at,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,token`,[subject,subjectId,token,scope,expiresAt??null,userId]))!;}
export async function revokePublicLink(userId:string,id:number){const row=await queryOne<{subjectType:ShareSubject;subjectId:string}>(`SELECT subject_type AS "subjectType",subject_id AS "subjectId" FROM public_link WHERE id=$1`,[id]);if(!row)throw new AuthzError("not_found","Public link not found");await requireWorkspaceRole(userId,await workspaceFor(row.subjectType,row.subjectId),"admin");await query(`DELETE FROM public_link WHERE id=$1`,[id]);}
export async function grantObjectShare(userId:string,subject:ObjectShareSubject,subjectId:string,targetUserId:string,canEdit:boolean){const workspaceId=await workspaceFor(subject,subjectId);await requireWorkspaceRole(userId,workspaceId,"admin");const member=await queryOne<{id:string}>(`SELECT user_id AS id FROM workspace_member WHERE workspace_id=$1 AND user_id=$2`,[workspaceId,targetUserId]);if(!member)throw new AuthzError("not_found","Guest not found in this workspace");await query(`INSERT INTO object_share(subject_type,subject_id,user_id,can_edit) VALUES($1,$2,$3,$4) ON CONFLICT(subject_type,subject_id,user_id) DO UPDATE SET can_edit=EXCLUDED.can_edit`,[subject,subjectId,targetUserId,canEdit]);}
export async function revokeObjectShare(userId:string,subject:ObjectShareSubject,subjectId:string,targetUserId:string){const workspaceId=await workspaceFor(subject,subjectId);await requireWorkspaceRole(userId,workspaceId,"admin");await query(`DELETE FROM object_share WHERE subject_type=$1 AND subject_id=$2 AND user_id=$3`,[subject,subjectId,targetUserId]);}
export async function listPublicLinks(userId:string,subject:ShareSubject,subjectId:string){await requireWorkspaceRole(userId,await workspaceFor(subject,subjectId),"admin");return query<{id:number;token:string;scope:"read"|"submit";expiresAt:string|null;createdAt:string}>(`SELECT id,token,scope,expires_at AS "expiresAt",created_at AS "createdAt" FROM public_link WHERE subject_type=$1 AND subject_id=$2 ORDER BY id`,[subject,subjectId]);}
export async function listObjectShares(userId:string,subject:ShareSubject,subjectId:string){await requireWorkspaceRole(userId,await workspaceFor(subject,subjectId),"admin");return query<{userId:string;name:string;email:string;canEdit:boolean;createdAt:string}>(`SELECT s.user_id AS "userId",u.name,u.email,s.can_edit AS "canEdit",s.created_at AS "createdAt" FROM object_share s JOIN "user" u ON u.id=s.user_id WHERE s.subject_type=$1 AND s.subject_id=$2 ORDER BY s.created_at,s.user_id`,[subject,subjectId]);}
/** The unexpired form-scope link joined to its still-existing form — the one resolution both public form paths share. */
async function resolveFormLink(token:string){const row=await queryOne<{linkId:number;createdBy:string;formId:number;name:string;description:string;fields:FormField[];isOpen:boolean}>(`SELECT p.id AS "linkId",p.created_by AS "createdBy",f.id AS "formId",f.name,f.description,f.fields,f.is_open AS "isOpen" FROM public_link p JOIN form f ON f.id=p.subject_id::int WHERE p.token=$1 AND p.subject_type='form' AND p.scope='submit' AND (p.expires_at IS NULL OR p.expires_at>now())`,[token]);if(!row)throw new AuthzError("not_found","Public form not found");return row;}
/** The render data an anonymous visitor may see: the questions, nothing about the board behind them. */
export async function getPublicForm(token:string){const f=await resolveFormLink(token);return{name:f.name,description:f.description,fields:f.fields,isOpen:f.isOpen};}
/**
 * Anonymous intake (§3.9). The token is the whole authorization; the write then
 * rides submitForm AS THE LINK'S MINTER — an admin at mint time — so routing,
 * tenancy checks, activity logging and request_meta stamping all compile through
 * the same server path as an authenticated submit. The requester override makes
 * the Requests queue read "public", not the minting admin.
 */
export async function submitPublicForm(token:string,answers:string[]){const link=await resolveFormLink(token);const task=await submitForm(link.createdBy,link.formId,{answers},{type:"public",id:`public-link:${link.linkId}`});return{taskId:task.id};}
/** The unexpired feedback-scope link joined to its still-existing board — the one
 *  resolution both public feedback paths share, mirroring resolveFormLink. */
async function resolveFeedbackLink(token:string){const row=await queryOne<{linkId:number;createdBy:string;boardId:number;boardName:string}>(`SELECT p.id AS "linkId",p.created_by AS "createdBy",b.id AS "boardId",b.name AS "boardName" FROM public_link p JOIN board b ON b.id=p.subject_id::int WHERE p.token=$1 AND p.subject_type='feedback' AND p.scope='submit' AND (p.expires_at IS NULL OR p.expires_at>now())`,[token]);if(!row)throw new AuthzError("not_found","Feedback portal not found");return row;}
/**
 * What an anonymous visitor may see of a feedback portal: the name of the thing
 * they are giving feedback about, and nothing else.
 *
 * Deliberately not the ideas backlog. A public roadmap is a genuinely valuable
 * share (3.10 names it) but it is a DIFFERENT one: every idea title on the board
 * becomes public the moment a portal link is minted, including the ones nobody
 * vetted for external eyes, and an admin minting "let people tell us what they
 * think" is not consenting to that. Submit-only keeps the link's blast radius to
 * what its name promises.
 */
export async function getPublicFeedbackPortal(token:string){const link=await resolveFeedbackLink(token);return{boardName:link.boardName};}
/**
 * Anonymous feedback intake (3.10 over 043). The token is the whole
 * authorization; the write then rides createFeedback AS THE LINK'S MINTER — an
 * admin at mint time — so the board membership check, the tenancy rules and the
 * insert all compile through the same server path an authenticated capture does.
 *
 * It lands unfiled (`ideaId: null`), in the inbox, because filing a signal under
 * an idea is a triage judgement and the submitter is not the one making it. The
 * source is whatever the visitor typed about themselves, or 'public' — the field
 * is a label on a signal, not a contact record, so an empty one is fine and no
 * email column is invented here to hold something the app never promised to
 * protect.
 */
export async function submitPublicFeedback(token:string,input:{body:string;sentiment?:FeedbackSentiment;source?:string}){const link=await resolveFeedbackLink(token);const feedback=await createFeedback(link.createdBy,link.boardId,{body:input.body,sentiment:input.sentiment,source:input.source?.trim()||"public",ideaId:null});return{feedbackId:feedback.id};}
export async function getPublicBoard(token:string){const board=await queryOne<{id:number;name:string}>(`SELECT b.id,b.name FROM public_link p JOIN board b ON b.id=p.subject_id::int WHERE p.token=$1 AND p.subject_type='board' AND p.scope='read' AND (p.expires_at IS NULL OR p.expires_at>now())`,[token]);if(!board)throw new AuthzError("not_found","Public board not found");const columns=await query<{id:number;title:string;position:number}>(`SELECT id,title,position FROM board_column WHERE board_id=$1 ORDER BY position,id`,[board.id]);const tasks=await query<{id:number;columnId:number;title:string;description:string}>(`SELECT t.id,t.column_id AS "columnId",t.title,t.description FROM task t WHERE t.column_id IN(SELECT id FROM board_column WHERE board_id=$1) AND t.parent_id IS NULL ORDER BY t.position`,[board.id]);return{...board,columns,tasks};}
export async function getSharedBoard(userId:string,boardId:number){const shared=await queryOne<{canEdit:boolean}>(`SELECT can_edit AS "canEdit" FROM object_share WHERE subject_type='board' AND subject_id=$1 AND user_id=$2`,[String(boardId),userId]);if(!shared)throw new AuthzError("not_found","Board not found");const columns=await query<{id:number;title:string;position:number}>(`SELECT id,title,position FROM board_column WHERE board_id=$1 ORDER BY position,id`,[boardId]);if(!columns.length)throw new AuthzError("not_found","Board not found");const board=await queryOne<{id:number;name:string}>(`SELECT id,name FROM board WHERE id=$1`,[boardId]);const tasks=await query<{id:number;columnId:number;title:string;description:string}>(`SELECT id,column_id AS "columnId",title,description FROM task WHERE column_id=ANY($1) AND parent_id IS NULL ORDER BY position`,[columns.map(c=>c.id)]);return{...board!,columns,tasks,canEdit:shared.canEdit};}
