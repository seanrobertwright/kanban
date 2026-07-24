import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getDefaultBoard, ensurePersonalWorkspace } from "@/features/workspaces/server/repository";
import { pool, query } from "@/shared/db/client";
import { createDoc, deleteDoc, listDocRevisions, listDocs, updateDoc } from "./repository";

describe("docs (db)", () => {
  const users: string[] = [];
  let alice: string;
  let workspaceId: string;
  let boardId: number;

  beforeAll(async () => {
    alice = `test-docs-${randomUUID()}`;
    users.push(alice);
    await query(`INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1,$2,$3,true)`, [alice, "Doc Alice", `${alice}@example.test`]);
    await ensurePersonalWorkspace(alice, "Doc Alice");
    const board = (await getDefaultBoard(alice))!;
    workspaceId = board.workspaceId;
    boardId = board.id;
  });
  afterAll(async () => {
    await query(`DELETE FROM workspace w WHERE EXISTS (SELECT 1 FROM workspace_member m WHERE m.workspace_id=w.id AND m.user_id = ANY($1))`, [users]);
    await query(`DELETE FROM "user" WHERE id = ANY($1)`, [users]);
    await pool.end();
  });

  it("creates a board doc, keeps revisions, and finds published knowledge", async () => {
    const parent = await createDoc(alice, workspaceId, { title: "Engineering", body: "Welcome" });
    const child = await createDoc(alice, workspaceId, { title: "Deploy runbook", body: "Use blue green deploy", parentId: parent.id, boardId, isPublished: true });
    expect(child).toMatchObject({ parentId: parent.id, boardId, isPublished: true });

    await updateDoc(alice, child.id, { body: "Use safe blue green deploy" });
    const revisions = await listDocRevisions(alice, child.id);
    expect(revisions[0]).toMatchObject({ body: "Use blue green deploy", editedBy: alice });

    const result = await listDocs(alice, workspaceId, "green");
    expect(result.map((doc) => doc.id)).toContain(child.id);
  });

  it("refuses cross-workspace parenting and needs admin to delete", async () => {
    const bob = `test-docs-bob-${randomUUID()}`;
    users.push(bob);
    await query(`INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1,$2,$3,true)`, [bob, "Doc Bob", `${bob}@example.test`]);
    await ensurePersonalWorkspace(bob, "Doc Bob");
    const bobBoard = (await getDefaultBoard(bob))!;
    const bobDoc = await createDoc(bob, bobBoard.workspaceId, { title: "Bob private" });

    await expect(createDoc(alice, workspaceId, { title: "Bad child", parentId: bobDoc.id })).rejects.toThrow(/Parent document/);
    await query(`INSERT INTO workspace_member (workspace_id, user_id, role) VALUES ($1,$2,'member')`, [workspaceId, bob]);
    const own = await createDoc(bob, workspaceId, { title: "Delete me" });
    await expect(deleteDoc(bob, own.id)).rejects.toThrow(/requires admin/);
    expect(await deleteDoc(alice, own.id)).toBe(true);
  });
});
