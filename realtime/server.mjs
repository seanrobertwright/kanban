// Separate from Next: standalone Next builds cannot host a custom WebSocket
// server.  This process speaks the stable Yjs 13 y-websocket protocol.
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
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try { const data = JSON.parse(Buffer.from(payload, "base64url").toString()); return data.exp > Date.now() ? data : null; } catch { return null; }
}

setPersistence({
  async bindState(name, ydoc) {
    const docId = Number(name.replace(/^doc-/, ""));
    const snapshot = await pool.query("SELECT state FROM doc_yjs_snapshot WHERE doc_id=$1", [docId]);
    if (snapshot.rows[0]) Y.applyUpdate(ydoc, new Uint8Array(snapshot.rows[0].state));
    const updates = await pool.query("SELECT update FROM doc_yjs_update WHERE doc_id=$1 ORDER BY id", [docId]);
    for (const row of updates.rows) Y.applyUpdate(ydoc, new Uint8Array(row.update));
    ydoc.on("update", (update) => pool.query("INSERT INTO doc_yjs_update (doc_id, update) VALUES ($1,$2)", [docId, Buffer.from(update)]).catch(console.error));
  },
  async writeState(name, ydoc) {
    const docId = Number(name.replace(/^doc-/, ""));
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO doc_yjs_snapshot (doc_id,state,updated_at) VALUES ($1,$2,now()) ON CONFLICT (doc_id) DO UPDATE SET state=EXCLUDED.state,updated_at=now()", [docId, Buffer.from(Y.encodeStateAsUpdate(ydoc))]);
      await client.query("DELETE FROM doc_yjs_update WHERE doc_id=$1", [docId]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  },
  provider: null,
});

const wss = new WebSocket.Server({ noServer: true });
wss.on("connection", setupWSConnection);
const server = http.createServer((_req, res) => res.end("ok"));
server.on("upgrade", async (request, socket, head) => {
  const url = new URL(request.url, "http://realtime");
  const docId = Number(url.pathname.slice(1).replace(/^doc-/, ""));
  const ticket = verifyTicket(url.searchParams.get("ticket"));
  if (!ticket || ticket.docId !== docId) return socket.destroy();
  const allowed = await pool.query(`SELECT 1 FROM doc d JOIN workspace_member wm ON wm.workspace_id=d.workspace_id AND wm.user_id=$2 WHERE d.id=$1 AND (wm.role <> 'guest' OR EXISTS (SELECT 1 FROM object_share os WHERE os.subject_type='doc' AND os.subject_id=d.id::text AND os.user_id=$2))`, [docId, ticket.userId]);
  if (!allowed.rowCount) return socket.destroy();
  wss.handleUpgrade(request, socket, head, (ws) => wss.emit("connection", ws, request, { docName: `doc-${docId}` }));
});
server.listen(Number(process.env.REALTIME_PORT ?? 1234), process.env.REALTIME_HOST ?? "0.0.0.0");
