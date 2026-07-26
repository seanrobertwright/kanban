import { query, queryOne, withTransaction } from "@/shared/db/client";
import { logActivity } from "@/features/activity/server/repository";
import type { ChatMessageSnapshot } from "@/features/activity/types";
import { AuthzError, requireWorkspaceRole } from "@/features/workspaces/server/authz";
import type { Channel, ChannelMember, ChatMessage } from "../types";

const CHANNEL = `id, workspace_id AS "workspaceId", name, is_private AS "isPrivate", created_by AS "createdBy", created_at AS "createdAt"`;
// Unread = someone else's message after my last look (081); epoch when I never looked, so a fresh member sees every active channel marked.
const UNREAD = `EXISTS (SELECT 1 FROM chat_message um WHERE um.channel_id=c.id AND um.author_id<>$2 AND um.created_at > COALESCE((SELECT cs.last_seen_at FROM channel_seen cs WHERE cs.channel_id=c.id AND cs.user_id=$2),'epoch'::timestamptz)) AS "hasUnread"`;
// Author name resolved at read time, LEFT so a deleted author's messages outlive them as a null name — the comment feed's rule (024).
const MESSAGE = `m.id, m.channel_id AS "channelId", m.author_id AS "authorId", u.name AS "authorName", m.body, m.parent_id AS "parentId", m.created_at AS "createdAt"`;

export async function listChannels(userId: string, workspaceId: string): Promise<Channel[]> { await requireWorkspaceRole(userId, workspaceId, "viewer"); return query<Channel>(`SELECT ${CHANNEL}, ${UNREAD} FROM channel c WHERE c.workspace_id=$1 AND (NOT c.is_private OR EXISTS (SELECT 1 FROM channel_member cm WHERE cm.channel_id=c.id AND cm.user_id=$2)) ORDER BY c.name`, [workspaceId,userId]); }
export async function createChannel(userId: string, workspaceId: string, name: string, isPrivate=false): Promise<Channel> { await requireWorkspaceRole(userId,workspaceId,"member"); const row=await queryOne<Channel>(`INSERT INTO channel (workspace_id,name,is_private,created_by) VALUES ($1,$2,$3,$4) RETURNING ${CHANNEL}, false AS "hasUnread"`,[workspaceId,name.trim(),isPrivate,userId]); if (!row) throw new Error("Could not create channel"); await query(`INSERT INTO channel_member (channel_id,user_id) VALUES ($1,$2)`,[row.id,userId]); return row; }
/** The one gate every per-channel call goes through. Private + nonmember reads "not_found" — the anti-oracle answer. Returns what postMessage's snapshot and the member calls need, so none of them re-reads the channel. */
async function access(userId:string, channelId:number, write=false): Promise<{workspaceId:string;isPrivate:boolean;name:string}> { const row=await queryOne<{workspaceId:string;isPrivate:boolean;name:string;member:boolean}>(`SELECT c.workspace_id AS "workspaceId",c.is_private AS "isPrivate",c.name,EXISTS(SELECT 1 FROM channel_member cm WHERE cm.channel_id=c.id AND cm.user_id=$2) AS member FROM channel c WHERE c.id=$1`,[channelId,userId]); if(!row) throw new AuthzError("not_found","Channel not found"); await requireWorkspaceRole(userId,row.workspaceId,write?"member":"viewer"); if(row.isPrivate&&!row.member) throw new AuthzError("not_found","Channel not found"); return row; }
export async function listMessages(userId:string,channelId:number):Promise<ChatMessage[]> { await access(userId,channelId); return query<ChatMessage>(`SELECT ${MESSAGE} FROM chat_message m LEFT JOIN "user" u ON u.id=m.author_id WHERE m.channel_id=$1 ORDER BY m.created_at ASC`,[channelId]); }
/**
 * Posts a message, threading it under `parentId` when given. Two rules a reply
 * must pass, assertReplyable's shape (033): the parent lives in this same
 * channel (else not_found — the anti-oracle answer for a cross-channel probe),
 * and threads are one level deep (else conflict — the UI replies to the root).
 *
 * Mentions are derived server-side from the body against member names — the
 * exact-name rule syncMentions (024) states — inside the same transaction, so
 * the message and the record that it named someone commit together. Messages
 * that mention nobody write NO activity row: chat is talk, not board mutation,
 * and logging every message would bury the audit trail (see ChatAction).
 */
export async function postMessage(userId:string,channelId:number,body:string,parentId?:number|null):Promise<ChatMessage>{
 const channel=await access(userId,channelId,true);
 return withTransaction(async client=>{
  if(parentId!=null){const {rows:[parent]}=await client.query<{channelId:number;parentId:number|null}>(`SELECT channel_id AS "channelId", parent_id AS "parentId" FROM chat_message WHERE id=$1`,[parentId]);if(!parent||parent.channelId!==channelId)throw new AuthzError("not_found","That message is not in this channel");if(parent.parentId!==null)throw new AuthzError("conflict","A reply cannot have replies of its own");}
  const {rows:[inserted]}=await client.query<{id:number}>(`INSERT INTO chat_message(channel_id,author_id,body,parent_id) VALUES($1,$2,$3,$4) RETURNING id`,[channelId,userId,body.trim(),parentId??null]);
  const {rows:mentioned}=await client.query<{id:string}>(`SELECT u.id FROM workspace_member wm JOIN "user" u ON u.id=wm.user_id WHERE wm.workspace_id=$1 AND position(lower('@'||u.name) IN lower($2))>0`,[channel.workspaceId,body]);
  const {rows:[message]}=await client.query<ChatMessage>(`SELECT ${MESSAGE} FROM chat_message m LEFT JOIN "user" u ON u.id=m.author_id WHERE m.id=$1`,[inserted.id]);
  if(mentioned.length){const snapshot:ChatMessageSnapshot={messageId:Number(message.id),channelId,channelName:channel.name,body:message.body,author:{type:"human",id:userId},mentions:mentioned.map(r=>r.id)};await logActivity(client,{workspaceId:channel.workspaceId,boardId:null,taskId:null,actor:{type:"human",id:userId},action:"chat.mentioned",after:snapshot});}
  return message;
 });
}
export async function listChannelMembers(userId:string,channelId:number):Promise<ChannelMember[]>{ await access(userId,channelId); return query<ChannelMember>(`SELECT cm.user_id AS "userId", u.name FROM channel_member cm LEFT JOIN "user" u ON u.id=cm.user_id WHERE cm.channel_id=$1 ORDER BY u.name NULLS LAST`,[channelId]); }
/** Member-gated (access write=true proves workspace member + channel member for a private channel). Public channels have no roster to tend — conflict, not silence, so the UI learns the rule. */
export async function addChannelMember(userId:string,channelId:number,memberId:string):Promise<void>{ const channel=await access(userId,channelId,true); if(!channel.isPrivate) throw new AuthzError("conflict","Public channels need no member list"); const target=await queryOne(`SELECT 1 AS ok FROM workspace_member WHERE workspace_id=$1 AND user_id=$2`,[channel.workspaceId,memberId]); if(!target) throw new AuthzError("not_found","Not a workspace member"); await query(`INSERT INTO channel_member (channel_id,user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,[channelId,memberId]); }
/** The last member cannot be removed: a private channel with nobody in it is unreachable forever (listChannels hides it from everyone), which is deletion by accident. */
export async function removeChannelMember(userId:string,channelId:number,memberId:string):Promise<void>{ const channel=await access(userId,channelId,true); if(!channel.isPrivate) throw new AuthzError("conflict","Public channels need no member list"); const count=await queryOne<{n:string}>(`SELECT count(*) AS n FROM channel_member WHERE channel_id=$1`,[channelId]); if(Number(count?.n??0)<=1) throw new AuthzError("conflict","A private channel keeps its last member"); await query(`DELETE FROM channel_member WHERE channel_id=$1 AND user_id=$2`,[channelId,memberId]); }
/**
 * Opens (or reuses) the DM between the caller and one other member: a private
 * channel whose member set is exactly the pair. Reuse matches on the member
 * set, never the name — the pair IS the identity, and a rename must not fork a
 * second thread. Created lazily with a name after the pair; the name is
 * display, so a collision (two pairs of same-named people) just gets a suffix.
 */
export async function openDm(userId:string,workspaceId:string,otherId:string):Promise<Channel>{
 await requireWorkspaceRole(userId,workspaceId,"member");
 if(otherId===userId) throw new AuthzError("conflict","A DM needs two people");
 const other=await queryOne<{name:string|null}>(`SELECT u.name FROM workspace_member wm JOIN "user" u ON u.id=wm.user_id WHERE wm.workspace_id=$1 AND wm.user_id=$2`,[workspaceId,otherId]);
 if(!other) throw new AuthzError("not_found","Not a workspace member");
 const existing=await queryOne<Channel>(`SELECT ${CHANNEL}, ${UNREAD} FROM channel c WHERE c.workspace_id=$1 AND c.is_private AND EXISTS(SELECT 1 FROM channel_member a WHERE a.channel_id=c.id AND a.user_id=$2) AND EXISTS(SELECT 1 FROM channel_member b WHERE b.channel_id=c.id AND b.user_id=$3) AND (SELECT count(*) FROM channel_member cm WHERE cm.channel_id=c.id)=2 ORDER BY c.id LIMIT 1`,[workspaceId,userId,otherId]);
 if(existing) return existing;
 const me=await queryOne<{name:string|null}>(`SELECT name FROM "user" WHERE id=$1`,[userId]);
 let name=`dm:${[me?.name??"?",other.name??"?"].sort((a,b)=>a.localeCompare(b)).join(" & ")}`;
 if(await queryOne(`SELECT 1 AS ok FROM channel WHERE workspace_id=$1 AND name=$2`,[workspaceId,name])) name=`${name} ${Date.now()%100000}`;
 return withTransaction(async client=>{
  const {rows:[channel]}=await client.query<Channel>(`INSERT INTO channel (workspace_id,name,is_private,created_by) VALUES ($1,$2,true,$3) RETURNING ${CHANNEL}, false AS "hasUnread"`,[workspaceId,name,userId]);
  await client.query(`INSERT INTO channel_member (channel_id,user_id) VALUES ($1,$2),($1,$3)`,[channel.id,userId,otherId]);
  return channel;
 });
}
/** "Mark all read" for one channel — a single UPSERT (081), markNotificationsSeen's shape. */
export async function markChannelSeen(userId:string,channelId:number):Promise<void>{ await access(userId,channelId); await query(`INSERT INTO channel_seen (channel_id,user_id,last_seen_at) VALUES ($1,$2,now()) ON CONFLICT (channel_id,user_id) DO UPDATE SET last_seen_at=now()`,[channelId,userId]); }
