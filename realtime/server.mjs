// Separate from Next: standalone Next builds cannot host a custom WebSocket
// server.  This process speaks the stable Yjs 13 y-websocket protocol.
//
// Two kinds of room live here, distinguished by the room name's prefix:
//
//   doc-<id>  a wiki page's Y.Text, persisted by 057
//   wb-<id>   a whiteboard's Y.Map of Excalidraw elements, persisted by 088
//
// y-websocket takes ONE persistence provider for every room, so the two kinds
// branch inside bindState/writeState rather than each owning a server.
import http from "node:http";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import pg from "pg";
import * as Y from "yjs";

const require = createRequire(import.meta.url);
const WebSocket = require("ws");
const { setupWSConnection, setPersistence } = require("y-websocket/bin/utils");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const secret = process.env.BETTER_AUTH_SECRET;
if (!secret) throw new Error("BETTER_AUTH_SECRET is required for realtime tickets");

function verifyTicket(value) {
  const [payload, signature] = (value ?? "").split(".");
  if (!payload || !signature) return null;
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  const given = Buffer.from(signature);
  const want = Buffer.from(expected);
  // Length must match before timingSafeEqual, which throws on a mismatch — a
  // throw here would be a 500-shaped answer to a forged ticket.
  if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) return null;
  try { const data = JSON.parse(Buffer.from(payload, "base64url").toString()); return data.exp > Date.now() ? data : null; } catch { return null; }
}

/** `doc-12` / `wb-12` → the kind and the subject id the ticket must match. */
function parseRoom(name) {
  const match = /^(doc|wb)-(\d+)$/.exec(name ?? "");
  if (!match) return null;
  return { kind: match[1] === "doc" ? "doc" : "whiteboard", id: Number(match[2]) };
}

/** The twin of sceneFromShared in features/whiteboards/lib/sync.ts: the shared
 * map painted as a scene, ordered by Excalidraw's fractional index. Duplicated
 * rather than imported because this process runs plain ESM outside the Next
 * build; the two must change together. */
function sceneFromMap(map) {
  return [...map.values()]
    .filter((element) => element && !element.isDeleted)
    .sort((a, b) => {
      const indexA = a.index ?? "";
      const indexB = b.index ?? "";
      return indexA === indexB ? String(a.id).localeCompare(String(b.id)) : indexA < indexB ? -1 : 1;
    });
}

async function bindDoc(docId, ydoc) {
  const snapshot = await pool.query("SELECT state FROM doc_yjs_snapshot WHERE doc_id=$1", [docId]);
  if (snapshot.rows[0]) Y.applyUpdate(ydoc, new Uint8Array(snapshot.rows[0].state));
  const updates = await pool.query("SELECT update FROM doc_yjs_update WHERE doc_id=$1 ORDER BY id", [docId]);
  for (const row of updates.rows) Y.applyUpdate(ydoc, new Uint8Array(row.update));
  ydoc.on("update", (update) => pool.query("INSERT INTO doc_yjs_update (doc_id, update) VALUES ($1,$2)", [docId, Buffer.from(update)]).catch(console.error));
}

/**
 * A whiteboard room opens on whichever copy of the canvas is newer: the CRDT
 * history, or `whiteboard.scene` as some client last PATCHed it. A deployment
 * can run without this process at all (the dialog falls back to the debounced
 * PATCH it has always used), so "there is Yjs state, therefore Yjs is the
 * truth" would silently discard every stroke drawn while the socket was down.
 * When the JSONB is the newer copy its history wins and the stale rows go: a
 * scene reseeded from JSON has no shared ancestry with the updates that preceded
 * it, and keeping them would resurrect deleted shapes on the next merge.
 */
async function bindWhiteboard(whiteboardId, ydoc) {
  const map = ydoc.getMap("elements");
  const { rows: [board] } = await pool.query(
    `SELECT w.scene, w.updated_at AS "updatedAt",
            GREATEST(COALESCE(s.updated_at, 'epoch'::timestamptz),
                     COALESCE((SELECT max(created_at) FROM whiteboard_yjs_update u WHERE u.whiteboard_id=w.id), 'epoch'::timestamptz)) AS "yjsAt"
       FROM whiteboard w LEFT JOIN whiteboard_yjs_snapshot s ON s.whiteboard_id=w.id
      WHERE w.id=$1`, [whiteboardId]);
  if (!board) return;
  const yjsIsNewer = board.yjsAt.getTime() > 0 && board.yjsAt >= board.updatedAt;
  if (yjsIsNewer) {
    const snapshot = await pool.query("SELECT state FROM whiteboard_yjs_snapshot WHERE whiteboard_id=$1", [whiteboardId]);
    if (snapshot.rows[0]) Y.applyUpdate(ydoc, new Uint8Array(snapshot.rows[0].state));
    const updates = await pool.query("SELECT update FROM whiteboard_yjs_update WHERE whiteboard_id=$1 ORDER BY id", [whiteboardId]);
    for (const row of updates.rows) Y.applyUpdate(ydoc, new Uint8Array(row.update));
  } else {
    await pool.query("DELETE FROM whiteboard_yjs_update WHERE whiteboard_id=$1", [whiteboardId]);
    await pool.query("DELETE FROM whiteboard_yjs_snapshot WHERE whiteboard_id=$1", [whiteboardId]);
    ydoc.transact(() => { for (const element of board.scene ?? []) if (element?.id) map.set(String(element.id), element); });
  }
  ydoc.on("update", (update) => pool.query("INSERT INTO whiteboard_yjs_update (whiteboard_id, update) VALUES ($1,$2)", [whiteboardId, Buffer.from(update)]).catch(console.error));
}

setPersistence({
  async bindState(name, ydoc) {
    const room = parseRoom(name);
    if (!room) return;
    if (room.kind === "doc") await bindDoc(room.id, ydoc);
    else await bindWhiteboard(room.id, ydoc);
  },
  async writeState(name, ydoc) {
    const room = parseRoom(name);
    if (!room) return;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      if (room.kind === "doc") {
        await client.query("INSERT INTO doc_yjs_snapshot (doc_id,state,updated_at) VALUES ($1,$2,now()) ON CONFLICT (doc_id) DO UPDATE SET state=EXCLUDED.state,updated_at=now()", [room.id, Buffer.from(Y.encodeStateAsUpdate(ydoc))]);
        await client.query("DELETE FROM doc_yjs_update WHERE doc_id=$1", [room.id]);
      } else {
        await client.query("INSERT INTO whiteboard_yjs_snapshot (whiteboard_id,state,updated_at) VALUES ($1,$2,now()) ON CONFLICT (whiteboard_id) DO UPDATE SET state=EXCLUDED.state,updated_at=now()", [room.id, Buffer.from(Y.encodeStateAsUpdate(ydoc))]);
        await client.query("DELETE FROM whiteboard_yjs_update WHERE whiteboard_id=$1", [room.id]);
        // The room is closing, so flatten it back into the column every reader
        // outside the room uses: the dialog's first paint, exports, agents.
        await client.query("UPDATE whiteboard SET scene=$2::jsonb, updated_at=now() WHERE id=$1", [room.id, JSON.stringify(sceneFromMap(ydoc.getMap("elements")))]);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  },
  provider: null,
});

/** Non-guest workspace membership, or an explicit share for a guest. */
async function docAllows(docId, userId) {
  const allowed = await pool.query(`SELECT 1 FROM doc d JOIN workspace_member wm ON wm.workspace_id=d.workspace_id AND wm.user_id=$2 WHERE d.id=$1 AND (wm.role <> 'guest' OR EXISTS (SELECT 1 FROM object_share os WHERE os.subject_type='doc' AND os.subject_id=d.id::text AND os.user_id=$2))`, [docId, userId]);
  return allowed.rowCount > 0;
}

/**
 * A socket is a write channel, so the ticket for one is minted behind the same
 * member gate `updateWhiteboard` uses — including 063's per-board grants, which
 * can make a viewer an editor of one board. This recheck deliberately does NOT
 * re-derive that lattice: its job is revocation inside the ticket's 60-second
 * window, so it asks the coarser question a removed collaborator fails —
 * "is this user still a non-guest member of the canvas's workspace" — and leaves
 * the fine-grained answer to the door that signed the ticket.
 */
async function whiteboardAllows(whiteboardId, userId) {
  const allowed = await pool.query(
    `SELECT 1 FROM whiteboard w
       JOIN board b ON b.id=w.board_id
       JOIN workspace_member wm ON wm.workspace_id=b.workspace_id AND wm.user_id=$2
      WHERE w.id=$1 AND wm.role <> 'guest'`, [whiteboardId, userId]);
  return allowed.rowCount > 0;
}

const wss = new WebSocket.Server({ noServer: true });
wss.on("connection", setupWSConnection);
const server = http.createServer((_req, res) => res.end("ok"));
server.on("upgrade", async (request, socket, head) => {
  const url = new URL(request.url, "http://realtime");
  const room = parseRoom(url.pathname.slice(1));
  const ticket = verifyTicket(url.searchParams.get("ticket"));
  // The ticket names its own kind, so a doc ticket cannot open the whiteboard
  // room that happens to share its id.
  if (!room || !ticket || ticket.kind !== room.kind || ticket.id !== room.id) return socket.destroy();
  const allowed = room.kind === "doc"
    ? await docAllows(room.id, ticket.userId)
    : await whiteboardAllows(room.id, ticket.userId);
  if (!allowed) return socket.destroy();
  const docName = room.kind === "doc" ? `doc-${room.id}` : `wb-${room.id}`;
  wss.handleUpgrade(request, socket, head, (ws) => wss.emit("connection", ws, request, { docName }));
});
server.listen(Number(process.env.REALTIME_PORT ?? 1234), process.env.REALTIME_HOST ?? "0.0.0.0");
