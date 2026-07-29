import { query, queryOne } from "@/shared/db/client";
import { AuthzError, requireBoardRole } from "@/features/workspaces/server/authz";
import { signRoomTicket } from "@/shared/realtime/ticket";
import type { Whiteboard } from "../types";
const C=`id,board_id AS "boardId",title,scene,created_at AS "createdAt",updated_at AS "updatedAt"`;
export async function listWhiteboards(userId:string,boardId:number):Promise<Whiteboard[]>{await requireBoardRole(userId,boardId,"viewer");return query<Whiteboard>(`SELECT ${C} FROM whiteboard WHERE board_id=$1 ORDER BY created_at`,[boardId]);}
export async function createWhiteboard(userId:string,boardId:number,title:string):Promise<Whiteboard>{await requireBoardRole(userId,boardId,"member");return (await queryOne<Whiteboard>(`INSERT INTO whiteboard(board_id,title) VALUES($1,$2) RETURNING ${C}`,[boardId,title.trim()]))!;}
export async function updateWhiteboard(userId:string,id:number,scene:unknown[]):Promise<Whiteboard>{await requireWhiteboardEditor(userId,id);return (await queryOne<Whiteboard>(`UPDATE whiteboard SET scene=$2::jsonb,updated_at=now() WHERE id=$1 RETURNING ${C}`,[id,JSON.stringify(scene)]))!;}

/** not_found before the role check, so the id space cannot be probed by telling
 * a 403 from a 404 — 060's rule, now shared by the PATCH and the socket ticket. */
async function requireWhiteboardEditor(userId:string,id:number):Promise<void>{const row=await queryOne<{boardId:number}>(`SELECT board_id AS "boardId" FROM whiteboard WHERE id=$1`,[id]);if(!row)throw new AuthzError("not_found","Whiteboard not found");await requireBoardRole(userId,row.boardId,"member");}

/**
 * A ticket for this canvas's realtime room (088). Member, not viewer: a socket
 * is a write channel — every peer in the room can mutate the shared scene — so
 * the gate is the same one `updateWhiteboard` uses, and a viewer keeps the
 * read-only path they already had (`viewModeEnabled` over the listed scene).
 */
export async function issueWhiteboardTicket(userId:string,id:number):Promise<string>{await requireWhiteboardEditor(userId,id);return signRoomTicket("whiteboard",id,userId);}
