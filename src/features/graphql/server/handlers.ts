import { getPrincipalFromRequest } from "@/features/auth/server/agent-auth";
import { asPrincipal } from "@/features/auth/server/principal";
import { unauthorized } from "@/features/auth/server/session";
import { takeToken } from "@/shared/lib/rate-limit";
import { MAX_QUERY_BYTES } from "./limits";
import { executeGraphQL } from "./schema";

/** Burst and sustained rate for one principal against the GraphQL door. Enough
 *  for an interactive client or an agent working a board; not enough for one
 *  key to hold the pool open. Static per-query limits bound the cost of a single
 *  request, this bounds how many of them arrive. */
const RATE = { capacity: 60, refillPerSecond: 1 };
/** Cheap pre-parse ceiling on the whole body: the query cap plus room for
 *  variables. Rejected on the declared length, before reading anything. */
const MAX_BODY_BYTES = MAX_QUERY_BYTES * 4;

/** The principal's own identity is the rate-limit key, not the IP: an agent key
 *  and the human who minted it are separate budgets, and two people behind one
 *  office NAT are not. */
function rateLimitKey(principal: Parameters<typeof asPrincipal>[0]): string {
  const p = asPrincipal(principal);
  return p.kind === "human" ? `graphql:human:${p.userId}` : `graphql:agent:${p.agentId}`;
}

/**
 * The GraphQL ingress (2.9). Auth is the shared principal resolution — a session
 * cookie or an x-agent-key, exactly what every other authenticated route uses — so
 * no principal at all is a 401.
 *
 * Status codes follow the GraphQL-over-HTTP split, which is the whole reason this
 * handler inspects the result at all:
 *
 *  - **4xx — the request was wrong.** Malformed body, oversized body, a query
 *    that fails validation, or one that trips a guard rail. Nothing executed, so
 *    there is no partial data to protect, and the caller has to change the query.
 *  - **200 with `errors` — the request was fine.** A resolver said no (usually
 *    authz). The convention matters here: a board the caller cannot read is a
 *    null field beside the fields they *can* read, not a failed request.
 */
export async function handleGraphQL(request: Request) {
  const principal = await getPrincipalFromRequest(request);
  if (!principal) return unauthorized();

  const limited = takeToken(rateLimitKey(principal), RATE);
  if (!limited.ok) {
    return Response.json(
      { errors: [{ message: "Too many requests" }] },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } }
    );
  }

  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) {
    return Response.json(
      { errors: [{ message: "Request body is too large" }] },
      { status: 413 }
    );
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || typeof (body as { query?: unknown }).query !== "string") {
    return Response.json({ errors: [{ message: "A GraphQL query is required" }] }, { status: 400 });
  }
  const { query, variables, operationName } = body as {
    query: string;
    variables?: Record<string, unknown> | null;
    operationName?: string | null;
  };

  // Length of the query text itself, in bytes rather than UTF-16 units — the
  // parser's work scales with what was actually sent.
  if (Buffer.byteLength(query, "utf8") > MAX_QUERY_BYTES) {
    return Response.json(
      { errors: [{ message: `Query text is over the ${MAX_QUERY_BYTES}-byte limit` }] },
      { status: 413 }
    );
  }

  const result = await executeGraphQL(principal, query, variables, operationName);
  // `data` absent means nothing executed — a syntax error, a validation failure,
  // a bad variable, or a guard rail. All of those are the caller's request to
  // fix, so 400; a resolver that refused would have produced `data` and a 200.
  if (result.data === undefined && result.errors?.length) {
    return Response.json(result, { status: 400 });
  }
  return Response.json(result);
}
