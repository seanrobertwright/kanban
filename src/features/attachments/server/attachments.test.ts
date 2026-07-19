import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getBoard } from "@/features/board/server/repository";
import {
  ensurePersonalWorkspace,
  getDefaultBoard,
} from "@/features/workspaces/server/repository";
import { createTask } from "@/features/tasks/server/repository";
import { pool, query } from "@/shared/db/client";
import {
  createAttachment,
  deleteAttachment,
  listAttachments,
  openAttachment,
} from "./repository";

/**
 * Against real Postgres AND real MinIO, because the whole point of this slice is
 * the seam between them: a row that names an object, bytes that round-trip
 * through the store, and an authz check a mock of either half would wave through.
 * Needs S3_* env and a running MinIO (docker compose up -d minio).
 */

const createdUsers: string[] = [];

async function createUser(label: string): Promise<string> {
  const id = `test-${label}-${randomUUID()}`;
  await query(
    `INSERT INTO "user" (id, name, email, "emailVerified")
     VALUES ($1, $2, $3, true)`,
    [id, `Test ${label}`, `${id}@example.test`]
  );
  createdUsers.push(id);
  return id;
}

async function bytesOf(stream: ReadableStream): Promise<Uint8Array> {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

describe("attachments", () => {
  let alice: string;
  let bob: string;
  let boardId: number;
  let todoId: number;
  let taskId: number;

  beforeAll(async () => {
    alice = await createUser("att-alice");
    await ensurePersonalWorkspace(alice, "AttAlice");
    const board = (await getDefaultBoard(alice))!;
    boardId = board.id;
    todoId = (await getBoard(alice, boardId))!.columns[0].id;
    taskId = (await createTask(alice, { columnId: todoId, title: "Has files" }))
      .id;

    bob = await createUser("att-bob");
    await ensurePersonalWorkspace(bob, "AttBob");
  });

  afterAll(async () => {
    await query(
      `DELETE FROM workspace w
        WHERE EXISTS (SELECT 1 FROM workspace_member m
                       WHERE m.workspace_id = w.id AND m.user_id = ANY($1))`,
      [createdUsers]
    );
    await query(`DELETE FROM "user" WHERE id = ANY($1)`, [createdUsers]);
    await pool.end();
  });

  it("round-trips a file through the object store", async () => {
    const body = new TextEncoder().encode("the quick brown fox — 021 attach");
    const created = await createAttachment(alice, taskId, {
      name: "note.txt",
      contentType: "text/plain",
      size: body.byteLength,
      body,
    });
    expect(created.name).toBe("note.txt");
    expect(created.size).toBe(body.byteLength);
    expect(created.uploadedBy).toBe(alice);

    const opened = await openAttachment(alice, created.id);
    expect(opened).toBeDefined();
    expect(opened!.contentType).toBe("text/plain");
    expect(await bytesOf(opened!.stream)).toEqual(body);

    // The card's derived count sees it.
    const task = (await getBoard(alice, boardId))!.tasks.find(
      (t) => t.id === taskId
    );
    expect(task!.attachmentCount).toBe(1);
  });

  it("hides a stranger's attachment behind not_found", async () => {
    const body = new TextEncoder().encode("secret");
    const created = await createAttachment(alice, taskId, {
      name: "secret.txt",
      contentType: "text/plain",
      size: body.byteLength,
      body,
    });
    // Bob is in another workspace: the attachment must be unreachable, and as
    // "gone" (undefined) rather than a forbidden that would confirm it exists.
    expect(await openAttachment(bob, created.id)).toBeUndefined();
    expect(await deleteAttachment(bob, created.id)).toBe(false);
  });

  it("removes the row and the object on delete", async () => {
    const body = new TextEncoder().encode("delete me");
    const created = await createAttachment(alice, taskId, {
      name: "temp.txt",
      contentType: "text/plain",
      size: body.byteLength,
      body,
    });
    expect(await deleteAttachment(alice, created.id)).toBe(true);
    expect(await openAttachment(alice, created.id)).toBeUndefined();
    const remaining = await listAttachments(alice, taskId);
    expect(remaining.some((a) => a.id === created.id)).toBe(false);
  });
});
