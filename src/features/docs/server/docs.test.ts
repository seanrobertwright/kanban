import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getDefaultBoard, ensurePersonalWorkspace } from "@/features/workspaces/server/repository";
import { pool, query } from "@/shared/db/client";
import {
  createDoc,
  deleteDoc,
  extractActionsFromMeeting,
  listDocRevisions,
  listDocs,
  promoteMeetingAction,
  requireSharedDoc,
  updateDoc,
} from "./repository";

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

  it("searches published docs only, and keeps a revision only when the body moves", async () => {
    const draft = await createDoc(alice, workspaceId, {
      title: "Draft plan",
      body: "zephyrsecret rollout",
    });
    const published = await createDoc(alice, workspaceId, {
      title: "Published plan",
      body: "zephyrsecret rollout",
      isPublished: true,
    });

    // Knowledge search is a publishing act, not a grep: an unpublished draft is
    // someone's thinking-in-progress and must not surface beside finished pages.
    const hits = (await listDocs(alice, workspaceId, "zephyrsecret")).map((d) => d.id);
    expect(hits).toContain(published.id);
    expect(hits).not.toContain(draft.id);

    // A title-only edit is not a body change, so it writes no revision — the
    // history is of the text, and a revision list padded with no-ops is one
    // nobody can restore from.
    const before = await listDocRevisions(alice, published.id);
    await updateDoc(alice, published.id, { title: "Published plan v2" });
    expect(await listDocRevisions(alice, published.id)).toHaveLength(before.length);

    await updateDoc(alice, published.id, { body: "zephyrsecret rollout, staged" });
    const after = await listDocRevisions(alice, published.id);
    expect(after).toHaveLength(before.length + 1);
    // The revision holds what the body WAS — restoring reads it back.
    expect(after[0].body).toBe("zephyrsecret rollout");
  });

  it("refuses a self-parent and a board from another workspace", async () => {
    const doc = await createDoc(alice, workspaceId, { title: "Loops" });
    await expect(
      updateDoc(alice, doc.id, { parentId: doc.id })
    ).rejects.toThrow(/own parent/);

    const carol = `test-docs-carol-${randomUUID()}`;
    users.push(carol);
    await query(
      `INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1,$2,$3,true)`,
      [carol, "Doc Carol", `${carol}@example.test`]
    );
    await ensurePersonalWorkspace(carol, "Doc Carol");
    const carolBoard = (await getDefaultBoard(carol))!;

    // The board reference is tenancy-checked on both doors, so a doc cannot be
    // filed against a board its workspace does not own.
    await expect(
      createDoc(alice, workspaceId, { title: "Wrong board", boardId: carolBoard.id })
    ).rejects.toThrow(/Board not found/);
    await expect(
      updateDoc(alice, doc.id, { boardId: carolBoard.id })
    ).rejects.toThrow(/Board not found/);
  });

  it("promotes a meeting action only where there is a board to promote it to", async () => {
    const page = await createDoc(alice, workspaceId, {
      title: "Not a meeting",
      body: "- [ ] something",
      boardId,
    });
    // Action items are a meeting-note affordance; asking a page for them is a
    // conflict rather than an empty list, so the caller learns the rule.
    await expect(extractActionsFromMeeting(alice, page.id)).rejects.toThrow(
      /meeting notes/i
    );

    const boardless = await createDoc(alice, workspaceId, {
      title: "Standup",
      body: "- [ ] ship the thing",
      kind: "meeting",
    });
    const actions = await extractActionsFromMeeting(alice, boardless.id);
    expect(actions.map((a) => a.title)).toContain("ship the thing");
    // No board means no implicit destination — refused rather than guessed at.
    await expect(
      promoteMeetingAction(alice, boardless.id, "ship the thing")
    ).rejects.toThrow(/board meeting note/);

    const meeting = await createDoc(alice, workspaceId, {
      title: "Sprint kickoff",
      body: "- [ ] write the runbook",
      kind: "meeting",
      boardId,
    });
    const task = await promoteMeetingAction(alice, meeting.id, "  write the runbook  ");
    expect(task.title).toBe("write the runbook");
    // The provenance rides the description, so the task says where it came from
    // without a second table to join.
    expect(task.description).toContain("Sprint kickoff");
  });

  it("a guest reads only what was explicitly shared with them", async () => {
    const guest = `test-docs-guest-${randomUUID()}`;
    users.push(guest);
    await query(
      `INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1,$2,$3,true)`,
      [guest, "Doc Guest", `${guest}@example.test`]
    );
    await query(
      `INSERT INTO workspace_member (workspace_id, user_id, role) VALUES ($1,$2,'guest')`,
      [workspaceId, guest]
    );

    const shared = await createDoc(alice, workspaceId, { title: "Shared with guest" });
    const private_ = await createDoc(alice, workspaceId, { title: "Not shared" });
    await query(
      `INSERT INTO object_share (subject_type, subject_id, user_id, can_edit)
       VALUES ('doc', $1, $2, false)`,
      [String(shared.id), guest]
    );

    // Guest membership exists so an admin can address them; it grants no
    // workspace-wide visibility, so the unshared doc is not_found, not 403.
    expect(await requireSharedDoc(guest, shared.id)).toMatchObject({ id: shared.id });
    await expect(requireSharedDoc(guest, private_.id)).rejects.toThrow(/not found/i);
    // Read-only share: editing is refused with the same non-committal answer.
    await expect(requireSharedDoc(guest, shared.id, true)).rejects.toThrow(/not found/i);
    await expect(listDocRevisions(guest, private_.id)).rejects.toThrow(/not found/i);
    await expect(
      updateDoc(guest, shared.id, { body: "guest edit" })
    ).rejects.toThrow(/not found/i);
  });
});
