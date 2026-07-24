import { query, queryOne } from "@/shared/db/client";
import { AuthzError, requireBoardRole } from "@/features/workspaces/server/authz";
import type { Whiteboard } from "../types";
const C=`id,board_id AS "boardId",title,scene,created_at AS "createdAt",updated_at AS "updatedAt"`;
export async function listWhiteboards(userId:string,boardId:number):Promise<Whiteboard[]>{await requireBoardRole(userId,boardId,"viewer");return query<Whiteboard>(`SELECT ${C} FROM whiteboard WHERE board_id=$1 ORDER BY created_at`,[boardId]);}
export async function createWhiteboard(userId:string,boardId:number,title:string):Promise<Whiteboard>{await requireBoardRole(userId,boardId,"member");return (await queryOne<Whiteboard>(`INSERT INTO whiteboard(board_id,title) VALUES($1,$2) RETURNING ${C}`,[boardId,title.trim()]))!;}
export async function updateWhiteboard(userId:string,id:number,scene:unknown[]):Promise<Whiteboard>{const row=await queryOne<{boardId:number}>(`SELECT board_id AS "boardId" FROM whiteboard WHERE id=$1`,[id]);if(!row)throw new AuthzError("not_found","Whiteboard not found");await requireBoardRole(userId,row.boardId,"member");return (await queryOne<Whiteboard>(`UPDATE whiteboard SET scene=$2::jsonb,updated_at=now() WHERE id=$1 RETURNING ${C}`,[id,JSON.stringify(scene)]))!;}
