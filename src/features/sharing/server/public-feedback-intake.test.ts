import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getBoardDiscovery } from "@/features/discovery/server/repository";
import { ensurePersonalWorkspace, getDefaultBoard } from "@/features/workspaces/server/repository";
import { pool, query, queryOne } from "@/shared/db/client";
import {
  getPublicFeedbackPortal,
  mintPublicLink,
  revokePublicLink,
  submitPublicFeedback,
} from "./repository";

/**
 * The public feedback portal (3.10 over 043) against the real database. The
 * capability machinery is 061's and already tested for forms; what is new and
 * worth a database here is that a *feedback* token lands a row on the token's
 * own board, in the inbox, and shows an anonymous visitor nothing else.
 */
describe("public feedback intake (db)", () => {
  const users: string[] = [];
  let ownerA: string;
  let ownerB: string;
  let boardA: number;
  let boardB: number;

  beforeAll(async () => {
    ownerA = `fb-a-${randomUUID()}`;
    ownerB = `fb-b-${randomUUID()}`;
    users.push(ownerA, ownerB);
    for (const id of users)
      await query(`INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,true)`, [id, id, `${id}@test`]);
    await ensurePersonalWorkspace(ownerA, "FbOwnerA");
    await ensurePersonalWorkspace(ownerB, "FbOwnerB");
    boardA = (await getDefaultBoard(ownerA))!.id;
    boardB = (await getDefaultBoard(ownerB))!.id;
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

  it("lands anonymous feedback in the token's own board inbox", async () => {
    const link = await mintPublicLink(ownerA, "feedback", String(boardA), "submit");
    const { feedbackId } = await submitPublicFeedback(link.token, {
      body: "The export button is hiding",
      sentiment: "problem",
      source: "Acme, via support",
    });

    const row = await queryOne<{
      boardId: number;
      ideaId: number | null;
      body: string;
      source: string;
      sentiment: string;
    }>(
      `SELECT board_id AS "boardId", idea_id AS "ideaId", body, source, sentiment
         FROM feedback WHERE id = $1`,
      [feedbackId]
    );
    // Tenancy: the token binds the write to its own board. There is no parameter
    // through which a visitor could reach workspace B.
    expect(row!.boardId).toBe(boardA);
    expect(row!.boardId).not.toBe(boardB);
    expect(row!.body).toBe("The export button is hiding");
    expect(row!.sentiment).toBe("problem");
    expect(row!.source).toBe("Acme, via support");
    // Unfiled — filing a signal under an idea is a triage judgement, and the
    // submitter is not the one making it.
    expect(row!.ideaId).toBeNull();

    const overview = await getBoardDiscovery(ownerA, boardA);
    expect(overview.feedback.some((f) => f.id === feedbackId)).toBe(true);
    expect(overview.unlinkedFeedback).toBeGreaterThan(0);
  });

  it("labels an unattributed submission 'public' rather than the minting admin", async () => {
    const link = await mintPublicLink(ownerA, "feedback", String(boardA), "submit");
    const { feedbackId } = await submitPublicFeedback(link.token, { body: "No name given" });
    const row = await queryOne<{ source: string }>(`SELECT source FROM feedback WHERE id=$1`, [
      feedbackId,
    ]);
    // The write rides the minter's authority, but it must not read as their signal.
    expect(row!.source).toBe("public");
  });

  it("shows a visitor the board's name and nothing else", async () => {
    const link = await mintPublicLink(ownerA, "feedback", String(boardA), "submit");
    const portal = await getPublicFeedbackPortal(link.token);
    // Submit-only by design: no ideas, no statuses, no demand numbers. A public
    // roadmap is a different share, and minting this one is not consent to it.
    expect(Object.keys(portal)).toEqual(["boardName"]);
  });

  it("refuses to mint a portal for another workspace's board", async () => {
    // Anti-enumeration: not_found rather than forbidden, the house rule.
    await expect(
      mintPublicLink(ownerB, "feedback", String(boardA), "submit")
    ).rejects.toThrow("not found");
  });

  it("rejects expired, revoked, and invented tokens", async () => {
    const expired = await mintPublicLink(
      ownerA,
      "feedback",
      String(boardA),
      "submit",
      new Date(Date.now() - 60_000).toISOString()
    );
    await expect(getPublicFeedbackPortal(expired.token)).rejects.toThrow();
    await expect(submitPublicFeedback(expired.token, { body: "Late" })).rejects.toThrow();

    const revoked = await mintPublicLink(ownerA, "feedback", String(boardA), "submit");
    await expect(getPublicFeedbackPortal(revoked.token)).resolves.toBeTruthy();
    await revokePublicLink(ownerA, revoked.id);
    await expect(submitPublicFeedback(revoked.token, { body: "Too late" })).rejects.toThrow();

    await expect(submitPublicFeedback("not-a-real-token", { body: "Nope" })).rejects.toThrow();
  });

  it("does not answer a feedback token from the board or form doors", async () => {
    const link = await mintPublicLink(ownerA, "feedback", String(boardA), "submit");
    const { getPublicBoard, getPublicForm } = await import("./repository");
    // Each resolver pins its own subject_type, so one capability cannot be spent
    // at another door — a submit-only portal token must not open a board read.
    await expect(getPublicBoard(link.token)).rejects.toThrow();
    await expect(getPublicForm(link.token)).rejects.toThrow();
  });

  it("refuses a read-scope feedback token", async () => {
    // scope is part of the resolution, not decoration: a link minted to read
    // cannot be spent to write.
    const link = await mintPublicLink(ownerA, "feedback", String(boardA), "read");
    await expect(getPublicFeedbackPortal(link.token)).rejects.toThrow();
    await expect(submitPublicFeedback(link.token, { body: "Wrong scope" })).rejects.toThrow();
  });
});
