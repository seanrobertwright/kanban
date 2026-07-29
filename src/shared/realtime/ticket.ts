import crypto from "node:crypto";

/**
 * One ticket shape for every realtime room, because the socket service (which
 * lives outside Next, in `realtime/server.mjs`) has to verify all of them with
 * one function. `kind` is what makes a doc ticket unusable on a whiteboard room
 * and vice versa: without it, a signed `{id:7}` would open room `doc-7` *and*
 * room `wb-7`, two unrelated subjects that happen to share a number.
 */
export type RoomKind = "doc" | "whiteboard";

export type RoomTicket = { kind: RoomKind; id: number; userId: string; exp: number };

/** The room name the socket service and the browser must agree on. */
export function roomName(kind: RoomKind, id: number): string {
  return `${kind === "doc" ? "doc" : "wb"}-${id}`;
}

/**
 * A short-lived, subject-scoped ticket for the separate Yjs service. It proves
 * only "this signed-in user asked for this room a moment ago" — the service
 * still rechecks live membership on upgrade, because a ticket minted before a
 * member was removed must not outlive their access by even a minute.
 */
export function signRoomTicket(kind: RoomKind, id: number, userId: string): string {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("BETTER_AUTH_SECRET is not configured");
  const ticket: RoomTicket = { kind, id, userId, exp: Date.now() + 60_000 };
  const payload = Buffer.from(JSON.stringify(ticket)).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}
