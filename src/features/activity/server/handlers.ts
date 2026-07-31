import { getPrincipalFromRequest } from "@/features/auth/server/agent-auth";
import { asPrincipal } from "@/features/auth/server/principal";
import {
  getSessionFromRequest,
  unauthorized,
} from "@/features/auth/server/session";
import { takeToken } from "@/shared/lib/rate-limit";
import { authzErrorResponse } from "@/features/workspaces/server/authz";
import { parseEventQuery } from "../lib/events";
import {
  listActivityForTask,
  listBoardEvents,
  listWorkspaceNotifications,
  markNotificationsSeen,
} from "./repository";

// getPrincipalFromRequest, not getSessionFromRequest: a task's history is part of
// the same access path §7.1 says an agent shares with a human, so the MCP door's
// agents read it the way they read the board — an agent that can write to the log
// but not read it back is blind to what it just did. The repository scopes an
// agent to its own workspace, so this widening grants no cross-tenant reach.
export async function handleListTaskActivity(request: Request, id: string) {
  const principal = await getPrincipalFromRequest(request);
  if (!principal) return unauthorized();

  const taskId = Number(id);
  if (!Number.isInteger(taskId)) {
    return Response.json({ error: "Invalid task id" }, { status: 400 });
  }

  try {
    return Response.json(await listActivityForTask(principal, taskId));
  } catch (error) {
    return authzErrorResponse(error);
  }
}

/** How often a held-open poll re-asks. One second is the resolution a waiting
 *  agent gets; the cost is one indexed range scan per second per waiting caller,
 *  which is why the rate limit below bounds how many of those there can be. */
const POLL_INTERVAL_MS = 1000;

/**
 * Burst and sustained rate for one principal against the feed. Sized for the
 * intended pattern — a poll a second, held open — so an agent that loops
 * correctly never sees a 429, and one that busy-loops with `wait=0` does within
 * a minute. Per principal, not per IP: an agent key and the human who minted it
 * are separate budgets (the rule the GraphQL door already follows).
 */
const RATE = { capacity: 60, refillPerSecond: 1 };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A board's change feed (§4.4 item 8): `GET /api/board/:id/events?since=…`,
 * optionally held open until something happens.
 *
 * Long-polled rather than streamed. SSE or a websocket would push with less
 * latency, but the caller this exists for is a stdio MCP process making one
 * `fetch` at a time, and a long poll is a `fetch` — no new transport, no new
 * port, no reconnect protocol, and it degrades to an ordinary request the
 * moment `wait` is omitted, which is what the UI would use.
 *
 * The wait ends on the first non-empty read, so a caller asking for 25 seconds
 * gets its answer in about one after a change lands. A timeout is a **200 with
 * an unchanged cursor**, not a 408: nothing failed, and an error status here
 * would train every caller to treat its own success path as a fault.
 *
 * Authz is re-checked on every iteration, because `listBoardEvents` checks it —
 * kept, not optimised away. A poll held open for 25 seconds spans a membership
 * revocation, and the alternative is a caller that keeps receiving a board's
 * activity for as long as it never reconnects.
 */
export async function handleBoardEvents(request: Request, id: string) {
  const principal = await getPrincipalFromRequest(request);
  if (!principal) return unauthorized();

  const boardId = Number(id);
  if (!Number.isInteger(boardId)) {
    return Response.json({ error: "Invalid board id" }, { status: 400 });
  }

  const p = asPrincipal(principal);
  const key =
    p.kind === "human" ? `events:human:${p.userId}` : `events:agent:${p.agentId}`;
  const limited = takeToken(key, RATE);
  if (!limited.ok) {
    return Response.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } }
    );
  }

  const parsed = parseEventQuery(new URL(request.url).searchParams);
  if ("error" in parsed) {
    return Response.json({ error: parsed.error }, { status: 400 });
  }
  const { since, limit, waitSeconds } = parsed.query;

  try {
    let page = await listBoardEvents(principal, boardId, { since, limit });
    // Nothing to wait for without a cursor: the first call's whole job is to
    // hand one out, and holding it open would stall every new caller for the
    // full timeout before it could even start.
    const deadline = Date.now() + (since === null ? 0 : waitSeconds * 1000);
    while (
      page.events.length === 0 &&
      Date.now() < deadline &&
      !request.signal.aborted
    ) {
      await sleep(Math.min(POLL_INTERVAL_MS, deadline - Date.now()));
      if (request.signal.aborted) break;
      page = await listBoardEvents(principal, boardId, { since, limit });
    }
    return Response.json(page);
  } catch (error) {
    return authzErrorResponse(error);
  }
}

// Human-only, unlike the task feed above: the notification bell is a person's
// inbox. An agent has no bell — it reads the board it acts on, it does not get
// pinged about it.
export async function handleListNotifications(
  request: Request,
  workspaceId: string
) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();
  try {
    return Response.json(
      await listWorkspaceNotifications(session.user.id, workspaceId)
    );
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleMarkNotificationsSeen(
  request: Request,
  workspaceId: string
) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();
  try {
    const lastSeenAt = await markNotificationsSeen(
      session.user.id,
      workspaceId
    );
    return Response.json({ lastSeenAt });
  } catch (error) {
    return authzErrorResponse(error);
  }
}
