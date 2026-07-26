import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createForm } from "@/features/forms/server/repository";
import { ensurePersonalWorkspace, getDefaultBoard } from "@/features/workspaces/server/repository";
import { pool, query, queryOne } from "@/shared/db/client";
import { getPublicForm, mintPublicLink, revokePublicLink, submitPublicForm } from "./repository";

/** Public/anonymous form intake (§3.9) against the real database. */
describe("public form intake (db)", () => {
  const users: string[] = [];
  let ownerA: string;
  let ownerB: string;
  let boardA: number;
  let boardB: number;
  let formA: number;

  beforeAll(async () => {
    ownerA = `pub-a-${randomUUID()}`;
    ownerB = `pub-b-${randomUUID()}`;
    users.push(ownerA, ownerB);
    for (const id of users)
      await query(`INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,true)`, [id, id, `${id}@test`]);
    await ensurePersonalWorkspace(ownerA, "OwnerA");
    await ensurePersonalWorkspace(ownerB, "OwnerB");
    boardA = (await getDefaultBoard(ownerA))!.id;
    boardB = (await getDefaultBoard(ownerB))!.id;
    formA = (
      await createForm(ownerA, boardA, {
        name: "Public bug intake",
        fields: [
          { label: "Title", type: "text", required: true },
          { label: "Details", type: "textarea", required: false },
        ],
      })
    ).id;
  });

  afterAll(async () => {
    await query(`DELETE FROM public_link WHERE created_by=ANY($1)`, [users]);
    await query(
      `DELETE FROM workspace w WHERE EXISTS(SELECT 1 FROM workspace_member m WHERE m.workspace_id=w.id AND m.user_id=ANY($1))`,
      [users]
    );
    await query(`DELETE FROM "user" WHERE id=ANY($1)`, [users]);
    await pool.end();
  });

  it("resolves a minted link and submits anonymously into the form's own board", async () => {
    const link = await mintPublicLink(ownerA, "form", String(formA), "submit");
    const rendered = await getPublicForm(link.token);
    expect(rendered.name).toBe("Public bug intake");
    expect(rendered.fields).toHaveLength(2);

    const { taskId } = await submitPublicForm(link.token, ["Crash on save", "It burns"]);
    const task = await queryOne<{ boardId: number; title: string; requestMeta: { requesterType: string; source: string } }>(
      `SELECT bc.board_id AS "boardId", t.title, t.request_meta AS "requestMeta"
         FROM task t JOIN board_column bc ON bc.id = t.column_id WHERE t.id = $1`,
      [taskId]
    );
    // Tenancy: the token binds the submission to the form's own board — there
    // is no parameter through which it could land in workspace B.
    expect(task!.boardId).toBe(boardA);
    expect(task!.boardId).not.toBe(boardB);
    expect(task!.title).toBe("Crash on save");
    // Attributed as public, not as the admin who minted the link.
    expect(task!.requestMeta.requesterType).toBe("public");
    expect(task!.requestMeta.source).toBe("Public bug intake");
  });

  it("refuses to mint a link for another workspace's form", async () => {
    // Anti-enumeration: workspace B's owner gets not_found, not forbidden.
    await expect(mintPublicLink(ownerB, "form", String(formA), "submit")).rejects.toThrow("not found");
  });

  it("rejects an expired token", async () => {
    const link = await mintPublicLink(
      ownerA,
      "form",
      String(formA),
      "submit",
      new Date(Date.now() - 60_000).toISOString()
    );
    await expect(getPublicForm(link.token)).rejects.toThrow();
    await expect(submitPublicForm(link.token, ["Late"])).rejects.toThrow();
  });

  it("rejects a revoked token", async () => {
    const link = await mintPublicLink(ownerA, "form", String(formA), "submit");
    await expect(getPublicForm(link.token)).resolves.toBeTruthy();
    await revokePublicLink(ownerA, link.id);
    await expect(getPublicForm(link.token)).rejects.toThrow();
    await expect(submitPublicForm(link.token, ["Too late"])).rejects.toThrow();
  });

  it("rejects a token that never existed", async () => {
    await expect(submitPublicForm("not-a-real-token", ["Nope"])).rejects.toThrow();
  });

  it("enforces the form's own validation on anonymous submits", async () => {
    const link = await mintPublicLink(ownerA, "form", String(formA), "submit");
    // The first answer is the title and is always required.
    await expect(submitPublicForm(link.token, ["", "details only"])).rejects.toThrow("required");
  });
});
