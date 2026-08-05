import { createHash, randomUUID } from "node:crypto";

import { getPrincipalFromRequest } from "@/features/auth/server/agent-auth";
import { asPrincipal, type Principal } from "@/features/auth/server/principal";
import { query } from "./client";
import { dryRunActive } from "./dry-run";

/**
 * Exactly-once creates (code review §4.4 item 3).
 *
 * The MCP door has always refused to retry a mutation, and its comment says
 * exactly why: a POST that timed out may well have been applied — the socket
 * died, not the transaction — so retrying risks a second task, a second comment,
 * a second claim. The consequence was that a single dropped packet left an agent
 * unable to tell whether its work landed, with no safe move available.
 *
 * A key makes the question answerable. The caller labels the attempt; the server
 * remembers the answer it gave under that label and replays it rather than doing
 * the work twice. The header is optional everywhere, so a caller that sends none
 * gets exactly the behaviour it had before this existed.
 *
 * **The row goes in before the work, not after.** A cache written on the way out
 * cannot stop two simultaneous retries — both would find nothing, both would
 * write. Inserting first, with a NULL status meaning "in flight", makes the
 * primary key itself the mutual exclusion: the loser of the race gets a 409 that
 * says "your first attempt is still running", which is a true statement and a
 * safe one to retry.
 */

/** How long a key is honoured. Comfortably longer than any client's retry
 *  window, short enough that this does not become the largest table in the
 *  schema — every create by every agent would otherwise be kept forever. */
const TTL_HOURS = 24;

/** Bounds on the header. Long enough for a UUID or an opaque vendor id, short
 *  enough that the key is never itself a payload. */
const MIN_KEY = 8;
const MAX_KEY = 255;

export const IDEMPOTENCY_HEADER = "idempotency-key";

/** Marks a replay so a caller can tell "you already did this" from "I did it
 *  now" — the difference matters when the response says a task was created. */
const REPLAY_HEADER = "idempotent-replay";

function principalKey(principal: Principal): string {
  return principal.kind === "human"
    ? `human:${principal.userId}`
    : `agent:${principal.agentId}`;
}

/**
 * What was asked, reduced to one comparable string. Method and path are in it
 * because the same key against a different endpoint is as much a caller bug as
 * the same key with a different body, and the raw text is hashed rather than the
 * parsed object so key ordering — which the caller controls and we do not —
 * never makes two identical requests look different.
 */
function fingerprint(method: string, path: string, rawBody: string): string {
  return createHash("sha256").update(`${method} ${path}\n${rawBody}`).digest("hex");
}

/** Fresh keys for a caller that wants one (tests, and any server-side retry). */
export const newIdempotencyKey = () => randomUUID();

interface StoredRow {
  fingerprint: string;
  status: number | null;
  body: string | null;
  contentType: string | null;
  expired: boolean;
}

const conflict = (message: string, code: string, status = 409) =>
  Response.json({ error: message, code }, { status });

/**
 * Run `work` at most once per (principal, key).
 *
 * Wrapped around a handler at the route boundary rather than inside it: every
 * create handler keeps its own body parsing and its own 401, and the diff that
 * makes an endpoint idempotent is one line in its route file. The body is read
 * here through `request.clone()`, so the handler still gets an unread stream.
 *
 * Both costs of that placement are paid only when the header is present: the
 * request without a key returns on the first line, and the extra principal
 * resolution — this one and the handler's — happens for keyed calls alone. No
 * principal is not an error here; the handler owns the 401, and answering it
 * from two places would let them disagree.
 *
 * Failures are not cached. A 5xx or a thrown error deletes the row, because the
 * whole point is to let the caller retry: remembering a failure would turn one
 * bad moment into a permanent one for that key. A 4xx *is* cached — it is a
 * deterministic answer about the request itself, and replaying it costs nothing.
 */
export async function withIdempotency(
  request: Request,
  work: () => Promise<Response>
): Promise<Response> {
  const key = request.headers.get(IDEMPOTENCY_HEADER);
  if (!key) return work();

  // A dry run creates nothing, so there is nothing to make exactly-once — and
  // claiming the key would spend it on a call that never happened, so the real
  // create that follows would replay a plan instead of creating. The wrapper
  // order (withDryRun outside withIdempotency) makes this reachable; this line
  // is what makes it correct.
  if (dryRunActive()) return work();

  const principal = await getPrincipalFromRequest(request);
  if (!principal) return work();

  if (key.length < MIN_KEY || key.length > MAX_KEY) {
    return Response.json(
      {
        error: `Idempotency-Key must be between ${MIN_KEY} and ${MAX_KEY} characters`,
        code: "INVALID_IDEMPOTENCY_KEY",
      },
      { status: 400 }
    );
  }

  const who = principalKey(asPrincipal(principal));
  const raw = await request.clone().text();
  const path = new URL(request.url).pathname;
  const print = fingerprint(request.method, path, raw);

  // Insert-first, and the ON CONFLICT clause doubles as the expiry: a row past
  // its TTL is taken over rather than left to block the key forever, so a
  // long-lived agent that recycles keys is not wedged by its own history.
  const claimed = await query<{ key: string }>(
    `INSERT INTO idempotency_key (key, principal, fingerprint)
     VALUES ($1, $2, $3)
     ON CONFLICT (principal, key) DO UPDATE
        SET fingerprint = EXCLUDED.fingerprint,
            status = NULL, body = NULL, content_type = NULL,
            created_at = now()
      WHERE idempotency_key.created_at < now() - ($4 || ' hours')::interval
     RETURNING key`,
    [key, who, print, String(TTL_HOURS)]
  );

  if (claimed.length === 0) {
    const [row] = await query<StoredRow>(
      `SELECT fingerprint, status, body, content_type AS "contentType",
              created_at < now() - ($3 || ' hours')::interval AS expired
         FROM idempotency_key WHERE principal = $1 AND key = $2`,
      [who, key, String(TTL_HOURS)]
    );
    // Vanished between the two statements — another request reaped or replaced
    // it. Treat as a fresh attempt rather than inventing an error for a state
    // the caller cannot act on.
    if (!row) return work();

    // Fingerprint before in-flight, deliberately: a different body under a live
    // key is a caller bug whether or not the first attempt has finished, and
    // answering "still running" would invite it to retry a request that can
    // never succeed under that key.
    if (row.fingerprint !== print) {
      return conflict(
        "This Idempotency-Key was already used for a different request",
        "CONFLICT_IDEMPOTENCY_KEY"
      );
    }
    if (row.status === null) {
      return conflict(
        "An earlier attempt with this Idempotency-Key is still running",
        "IDEMPOTENCY_IN_PROGRESS"
      );
    }
    return new Response(row.body, {
      status: row.status,
      headers: {
        "content-type": row.contentType ?? "application/json",
        [REPLAY_HEADER]: "true",
      },
    });
  }

  let response: Response;
  try {
    response = await work();
  } catch (error) {
    await release(who, key);
    throw error;
  }

  if (response.status >= 500) {
    await release(who, key);
    return response;
  }

  const body = await response.clone().text();
  await query(
    `UPDATE idempotency_key
        SET status = $3, body = $4, content_type = $5
      WHERE principal = $1 AND key = $2`,
    [who, key, response.status, body, response.headers.get("content-type")]
  );
  await reap();
  return response;
}

async function release(principal: string, key: string) {
  await query(`DELETE FROM idempotency_key WHERE principal = $1 AND key = $2`, [
    principal,
    key,
  ]);
}

/**
 * Opportunistic expiry, on a small share of successful writes.
 *
 * A cron job or a pg_cron extension would be tidier, but this app is
 * self-hosted with no scheduler of its own, and a table that only grows is a
 * worse outcome than an occasional extra DELETE. Bounded per call so a sweep
 * never turns one caller's create into a long transaction.
 */
async function reap() {
  if (Math.random() > 0.02) return;
  await query(
    `DELETE FROM idempotency_key
      WHERE ctid IN (
        SELECT ctid FROM idempotency_key
         WHERE created_at < now() - ($1 || ' hours')::interval
         LIMIT 500)`,
    [String(TTL_HOURS)]
  );
}
