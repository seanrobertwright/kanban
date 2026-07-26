import { query, withTransaction } from "@/shared/db/client";
import { requireWorkspaceRole } from "@/features/workspaces/server/authz";

export interface DiscoveryHit { subjectType: "task"|"comment"|"doc"|"activity"; id: string; title: string; excerpt: string; createdAt: string; }
export async function searchWorkspace(userId:string,workspaceId:string,term:string):Promise<DiscoveryHit[]>{
  await requireWorkspaceRole(userId,workspaceId,"admin"); const q=`%${term.trim()}%`; if(!term.trim())return [];
  return query<DiscoveryHit>(`SELECT * FROM (
    SELECT 'task'::text AS "subjectType",t.id::text AS id,t.title,left(t.description,500) AS excerpt,t.created_at AS "createdAt" FROM task t JOIN board_column c ON c.id=t.column_id JOIN board b ON b.id=c.board_id WHERE b.workspace_id=$1 AND (t.title ILIKE $2 OR t.description ILIKE $2)
    UNION ALL SELECT 'comment',cm.id::text,t.title,left(cm.body,500),cm.created_at FROM comment cm JOIN task t ON t.id=cm.task_id JOIN board_column c ON c.id=t.column_id JOIN board b ON b.id=c.board_id WHERE b.workspace_id=$1 AND cm.body ILIKE $2
    UNION ALL SELECT 'doc',d.id::text,d.title,left(d.body,500),d.created_at FROM doc d WHERE d.workspace_id=$1 AND (d.title ILIKE $2 OR d.body ILIKE $2)
    UNION ALL SELECT 'activity',a.id::text,a.action,left(coalesce(a.after::text,a.before::text,''),500),a.created_at FROM activity_log a WHERE a.workspace_id=$1 AND (a.action ILIKE $2 OR a.after::text ILIKE $2 OR a.before::text ILIKE $2)
  ) hits ORDER BY "createdAt" DESC LIMIT 500`,[workspaceId,q]);
}
export async function exportDiscovery(userId:string,workspaceId:string,term:string){
  const hits=await searchWorkspace(userId,workspaceId,term);
  // The manifest is scoped to the query, like the hits above it: attachments on
  // a task the term matched (title, description, or a comment on it) or whose
  // own filename matches — never the whole workspace's file listing. Empty term,
  // empty manifest, matching searchWorkspace's empty hits.
  const q=`%${term.trim()}%`;
  const attachments=term.trim()===""?[]:await query<{id:number;taskId:number;name:string;contentType:string;size:string}>(`SELECT a.id,a.task_id AS "taskId",a.name,a.content_type AS "contentType",a.size::text FROM attachment a JOIN task t ON t.id=a.task_id JOIN board_column c ON c.id=t.column_id JOIN board b ON b.id=c.board_id WHERE b.workspace_id=$1 AND (a.name ILIKE $2 OR t.title ILIKE $2 OR t.description ILIKE $2 OR EXISTS(SELECT 1 FROM comment cm WHERE cm.task_id=t.id AND cm.body ILIKE $2))`,[workspaceId,q]);
  await withTransaction(async client=>{await client.query(`INSERT INTO activity_log(workspace_id,board_id,task_id,actor_type,actor_id,action,after) VALUES($1,NULL,NULL,'human',$2,'ediscovery.export',jsonb_build_object('query',$3,'hitCount',$4))`,[workspaceId,userId,term,hits.length]);});
  return { generatedAt:new Date().toISOString(), query:term, hits, attachments };
}
