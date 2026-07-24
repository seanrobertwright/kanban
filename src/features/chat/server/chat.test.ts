import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensurePersonalWorkspace, getDefaultBoard } from "@/features/workspaces/server/repository";
import { pool, query } from "@/shared/db/client";
import { createChannel, listChannels, listMessages, postMessage } from "./repository";

describe("chat (db)", () => {
  const users: string[] = []; let alice: string; let bob: string; let workspaceId: string;
  beforeAll(async () => { alice=`chat-a-${randomUUID()}`;bob=`chat-b-${randomUUID()}`;users.push(alice,bob);for(const [id,name] of [[alice,"Alice"],[bob,"Bob"]])await query(`INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,true)`,[id,name,`${id}@test`]);await ensurePersonalWorkspace(alice,"Alice");const board=(await getDefaultBoard(alice))!;workspaceId=board.workspaceId;await query(`INSERT INTO workspace_member(workspace_id,user_id,role) VALUES($1,$2,'member')`,[workspaceId,bob]); });
  afterAll(async()=>{await query(`DELETE FROM workspace w WHERE EXISTS(SELECT 1 FROM workspace_member m WHERE m.workspace_id=w.id AND m.user_id=ANY($1))`,[users]);await query(`DELETE FROM "user" WHERE id=ANY($1)`,[users]);await pool.end();});
  it("shows workspace channels and persists a thread",async()=>{const channel=await createChannel(alice,workspaceId,"general");expect((await listChannels(bob,workspaceId)).map(c=>c.id)).toContain(channel.id);const root=await postMessage(alice,channel.id,"hello");await postMessage(bob,channel.id,"reply",root.id);expect((await listMessages(alice,channel.id)).map(m=>m.parentId)).toEqual([null,root.id]);});
  it("hides private channels from nonmembers",async()=>{const secret=await createChannel(alice,workspaceId,"secret",true);expect((await listChannels(bob,workspaceId)).map(c=>c.id)).not.toContain(secret.id);await expect(listMessages(bob,secret.id)).rejects.toThrow(/not found/i);});
});
