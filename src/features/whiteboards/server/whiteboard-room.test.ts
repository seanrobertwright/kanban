import { spawn, type ChildProcess } from "node:child_process";
import crypto, { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";

import {
  ensurePersonalWorkspace,
  getDefaultBoard,
} from "@/features/workspaces/server/repository";
import { pool, query, queryOne } from "@/shared/db/client";
import { signRoomTicket } from "@/shared/realtime/ticket";
import { createDoc } from "@/features/docs/server/repository";
import { createWhiteboard, issueWhiteboardTicket } from "./repository";
import type { SyncElement } from "../lib/sync";

/**
 * The realtime room itself (088), driven against the real socket service and a
 * real Postgres — because every claim worth making here is a claim about two
 * processes agreeing, and a mocked provider would prove only that the mock
 * merges. The service is spawned exactly as production runs it
 * (`node realtime/server.mjs`), so the ticket, the authz recheck, the room
 * naming and the persistence are all the shipped ones.
 */

const PORT = 14_123;
const ENDPOINT = `ws://127.0.0.1:${PORT}`;
const users: string[] = [];
let service: ChildProcess;

async function createUser(label: string): Promise<string> {
  const id = `test-wbroom-${label}-${randomUUID()}`;
  await query(
    `INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, true)`,
    [id, `Test ${label}`, `${id}@example.test`]
  );
  users.push(id);
  return id;
}

/** Polls a condition rather than sleeping a guessed interval: these are two
 * processes over a socket, and a fixed wait is either flaky or slow. */
async function until<T>(what: string, read: () => Promise<T> | T, ok: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const value = await read();
    if (ok(value)) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function connect(whiteboardId: number, ticket: string) {
  const ydoc = new Y.Doc();
  const provider = new WebsocketProvider(ENDPOINT, `wb-${whiteboardId}`, ydoc, {
    params: { ticket },
    WebSocketPolyfill: WebSocket as never,
  });
  await until("the room to sync", () => provider.synced, (synced) => synced);
  return { ydoc, provider, elements: ydoc.getMap<SyncElement>("elements") };
}

const shape = (id: string, version = 1): SyncElement => ({
  id, version, versionNonce: 1, index: "a1", type: "rectangle",
});

const sceneOf = async (id: number) =>
  (await queryOne<{ scene: SyncElement[] }>(`SELECT scene FROM whiteboard WHERE id=$1`, [id]))!.scene;

describe("whiteboard realtime room (service + db)", () => {
  let alice: string;
  let bob: string;
  let boardId: number;
  let workspaceId: string;

  beforeAll(async () => {
    alice = await createUser("alice");
    bob = await createUser("bob");
    const workspace = await ensurePersonalWorkspace(alice, "Alice");
    workspaceId = workspace.id;
    boardId = (await getDefaultBoard(alice))!.id;
    await query(
      `INSERT INTO workspace_member (workspace_id, user_id, role) VALUES ($1, $2, 'member')`,
      [workspace.id, bob]
    );

    service = spawn(process.execPath, ["realtime/server.mjs"], {
      env: { ...process.env, REALTIME_PORT: String(PORT), REALTIME_HOST: "127.0.0.1" },
      stdio: "ignore",
    });
    await until(
      "the realtime service to listen",
      async () => fetch(`http://127.0.0.1:${PORT}/`).then(() => true).catch(() => false),
      (up) => up
    );
  }, 30_000);

  afterAll(async () => {
    service?.kill();
    await query(
      `DELETE FROM workspace w WHERE EXISTS (
         SELECT 1 FROM workspace_member m WHERE m.workspace_id = w.id AND m.user_id = ANY($1))`,
      [users]
    );
    await query(`DELETE FROM "user" WHERE id = ANY($1)`, [users]);
    await pool.end();
  });

  it("merges two people drawing at once, then flattens the room into the scene", async () => {
    const board = await createWhiteboard(alice, boardId, "Shared canvas");
    const a = await connect(board.id, await issueWhiteboardTicket(alice, board.id));
    const b = await connect(board.id, await issueWhiteboardTicket(bob, board.id));

    // The pre-088 failure, drawn deliberately: both clients mutate the canvas
    // without either having seen the other's shape first. A whole-scene PATCH
    // resolves this as "last save wins" and one shape is gone with no error.
    a.elements.set("from-alice", shape("from-alice"));
    b.elements.set("from-bob", shape("from-bob"));

    await until("bob to see alice's shape", () => b.elements.has("from-alice"), (seen) => seen);
    await until("alice to see bob's shape", () => a.elements.has("from-bob"), (seen) => seen);

    // An edit to a shape someone else drew is a merge too, not a conflict.
    b.elements.set("from-alice", shape("from-alice", 2));
    await until(
      "alice to see the edit to her shape",
      () => a.elements.get("from-alice")?.version,
      (version) => version === 2
    );

    a.provider.destroy();
    b.provider.destroy();

    // The room is the truth only while it is open; every reader outside it —
    // the dialog's first paint, exports, agents — reads whiteboard.scene, so the
    // last collaborator leaving must flatten the CRDT back into that column.
    const scene = await until(
      "the room to flatten into whiteboard.scene",
      () => sceneOf(board.id),
      (elements) => elements.length === 2
    );
    expect(scene.map((element) => element.id).sort()).toEqual(["from-alice", "from-bob"]);
    expect(scene.find((element) => element.id === "from-alice")?.version).toBe(2);

    // And the CRDT history is compacted into one snapshot, not left as a log
    // that grows for the life of the canvas.
    const rows = await query<{ count: string }>(
      `SELECT (SELECT count(*) FROM whiteboard_yjs_update WHERE whiteboard_id=$1)::text AS count`,
      [board.id]
    );
    expect(rows[0].count).toBe("0");
  }, 30_000);

  it("opens on the newer copy when the scene was PATCHed with the room closed", async () => {
    const board = await createWhiteboard(alice, boardId, "Offline edit");
    const first = await connect(board.id, await issueWhiteboardTicket(alice, board.id));
    first.elements.set("drawn-in-room", shape("drawn-in-room"));
    first.provider.destroy();
    await until("the first session to persist", () => sceneOf(board.id), (scene) => scene.length === 1);

    // A deployment can run with no realtime service at all, so the dialog still
    // has its debounced PATCH. Strokes made that way are newer than the CRDT
    // history and must not be discarded when the room next opens.
    await query(`UPDATE whiteboard SET scene=$2::jsonb, updated_at=now() WHERE id=$1`, [
      board.id, JSON.stringify([shape("drawn-offline")]),
    ]);

    const second = await connect(board.id, await issueWhiteboardTicket(alice, board.id));
    await until("the room to reseed from the scene", () => second.elements.size, (size) => size === 1);
    expect([...second.elements.keys()]).toEqual(["drawn-offline"]);
    // And the superseded history is gone rather than merely ignored: reseeding
    // from JSON shares no ancestry with those updates, so keeping them would
    // resurrect the shape the PATCH replaced the moment the room closed.
    second.provider.destroy();
    const scene = await until(
      "the reseeded room to persist",
      () => sceneOf(board.id),
      (elements) => elements.length > 0
    );
    expect(scene.map((element) => element.id)).toEqual(["drawn-offline"]);
  }, 30_000);

  it("still serves the doc rooms it shared its persistence layer with", async () => {
    // 088 turned a doc-only service into a two-kind one, and docs had no test of
    // their own room. The regression this guards is the refactor's, not the
    // feature's: one persistence provider now branches on the room name, and a
    // wrong branch would silently write a page's text nowhere.
    const doc = await createDoc(alice, workspaceId, { title: "Shared page", body: "" });
    const room = `doc-${doc.id}`;
    const a = new Y.Doc();
    const providerA = new WebsocketProvider(ENDPOINT, room, a, {
      params: { ticket: signRoomTicket("doc", doc.id, alice) }, WebSocketPolyfill: WebSocket as never,
    });
    await until("alice's doc room to sync", () => providerA.synced, (synced) => synced);
    const b = new Y.Doc();
    const providerB = new WebsocketProvider(ENDPOINT, room, b, {
      params: { ticket: signRoomTicket("doc", doc.id, bob) }, WebSocketPolyfill: WebSocket as never,
    });
    await until("bob's doc room to sync", () => providerB.synced, (synced) => synced);

    a.getText("body").insert(0, "written together");
    await until(
      "bob to receive the text",
      () => b.getText("body").toString(),
      (text) => text === "written together"
    );

    providerA.destroy();
    providerB.destroy();
    const snapshot = await until(
      "the doc room to compact into a snapshot",
      () => query<{ id: number }>(`SELECT doc_id AS id FROM doc_yjs_snapshot WHERE doc_id=$1`, [doc.id]),
      (rows) => rows.length === 1
    );
    expect(snapshot).toHaveLength(1);

    // The inverse of the whiteboard guard below: a canvas ticket is no use here.
    const wrongKind = signRoomTicket("whiteboard", doc.id, alice);
    const socket = new WebSocket(`${ENDPOINT}/${room}?ticket=${encodeURIComponent(wrongKind)}`);
    await expect(new Promise((resolve) => {
      socket.onopen = () => { socket.close(); resolve("open"); };
      socket.onerror = () => resolve("closed");
      socket.onclose = () => resolve("closed");
    })).resolves.toBe("closed");
  }, 30_000);

  it("refuses a socket with another subject's ticket, or nobody's", async () => {
    const board = await createWhiteboard(alice, boardId, "Guarded");

    // The positive control first, so the three refusals below cannot pass by
    // the socket failing for some reason unrelated to the ticket.
    await expect(openRaw(board.id, await issueWhiteboardTicket(alice, board.id))).resolves.toBe("open");

    // Same integer, different subject: a doc ticket must not open wb-<id>. This
    // is the whole reason the ticket names its kind.
    const wrongKind = signRoomTicket("doc", board.id, alice);
    await expect(openRaw(board.id, wrongKind)).resolves.toBe("closed");
    // Unsigned, and signed-but-expired.
    await expect(openRaw(board.id, "not-a-ticket")).resolves.toBe("closed");
    const expired = expiredTicket(board.id, alice);
    await expect(openRaw(board.id, expired)).resolves.toBe("closed");
  }, 30_000);
});

/** Opens a bare socket and reports whether the service accepted it. */
function openRaw(whiteboardId: number, ticket: string): Promise<"open" | "closed"> {
  return new Promise((resolve) => {
    const socket = new WebSocket(`${ENDPOINT}/wb-${whiteboardId}?ticket=${encodeURIComponent(ticket)}`);
    socket.onopen = () => { socket.close(); resolve("open"); };
    socket.onerror = () => resolve("closed");
    socket.onclose = () => resolve("closed");
  });
}

/** A ticket the service must reject on age alone, signed the same way a live one
 * is — so the test proves the expiry check rather than a signature failure. */
function expiredTicket(id: number, userId: string): string {
  const payload = Buffer.from(JSON.stringify({ kind: "whiteboard", id, userId, exp: Date.now() - 1_000 })).toString("base64url");
  const signature = crypto.createHmac("sha256", process.env.BETTER_AUTH_SECRET!).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}
