// The HTTP core of the kanban CLI — "Door 4".
//
// A port of the request layer in mcp/server.mjs, kept as a separate copy on
// purpose: the doors are thin adapters over the same REST API and version
// independently. One difference is load-bearing here: `api()` returns
// { status, data } instead of the body alone, because a CLI's contract with
// its caller is the exit code, and 202 HELD_FOR_REVIEW must be
// distinguishable from 200 without parsing stdout.

import { randomUUID } from "node:crypto";

export class ApiError extends Error {
  constructor(code, status, message, retryable) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

// HTTP status → a code a script can branch on. The server's own `code` wins
// when present (HELD_FOR_REVIEW, BLOCKED_BY_POLICY); this table is the
// fallback. `retryable` is narrow: only a rate limit, a timeout, and a 5xx
// can come out differently on a second attempt.
function classify(status, body) {
  const serverCode = typeof body?.code === "string" ? body.code : null;
  if (serverCode === "IDEMPOTENCY_IN_PROGRESS") return [serverCode, true];
  const table = {
    400: ["INVALID_REQUEST", false],
    401: ["AUTH_INVALID", false],
    403: ["FORBIDDEN", false],
    404: ["NOT_FOUND", false],
    409: ["CONFLICT", false],
    413: ["TOO_LARGE", false],
    429: ["RATE_LIMITED", true],
  };
  if (table[status]) return [serverCode ?? table[status][0], table[status][1]];
  if (status >= 500) return [serverCode ?? "SERVER_ERROR", true];
  return [serverCode ?? "HTTP_ERROR", false];
}

export function createClient({ baseUrl, key, timeoutMs = 15000, dryRun = false }) {
  const BASE = baseUrl.replace(/\/$/, "");

  async function api(
    method,
    path,
    body,
    { retries = method === "GET" ? 2 : 0, timeout = timeoutMs, headers = {} } = {}
  ) {
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      if (attempt > 0) {
        const wait = 250 * 2 ** (attempt - 1) * (0.5 + Math.random());
        await new Promise((resolve) => setTimeout(resolve, wait));
      }
      let res;
      try {
        res = await fetch(`${BASE}${path}`, {
          method,
          headers: {
            "x-agent-key": key,
            ...(body ? { "content-type": "application/json" } : {}),
            ...(dryRun ? { "dry-run": "true" } : {}),
            ...headers,
          },
          body: body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(timeout),
        });
      } catch (cause) {
        lastError = new ApiError(
          cause?.name === "TimeoutError" ? "TIMEOUT" : "NETWORK_ERROR",
          0,
          `${method} ${path}: ${cause?.message ?? "request failed"}`,
          true
        );
        continue;
      }

      const text = await res.text();
      let data = null;
      let parseFailed = false;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          parseFailed = true;
        }
      }

      if (res.ok) {
        if (parseFailed) {
          throw new ApiError(
            "BAD_RESPONSE",
            res.status,
            `${method} ${path} returned a non-JSON body: ${text.slice(0, 200)}`,
            false
          );
        }
        return { status: res.status, data };
      }

      const [code, retryable] = classify(res.status, data);
      const message = parseFailed
        ? `${method} ${path} failed (${res.status}): ${text.slice(0, 200)}`
        : (data?.message ?? data?.error ?? `${method} ${path} failed (${res.status})`);
      lastError = new ApiError(code, res.status, message, retryable);
      if (!retryable) throw lastError;
    }
    throw lastError;
  }

  // A create that is safe to retry because it says which attempt it is: the
  // Idempotency-Key is minted once per command, outside the retry loop, so the
  // server can tell a retry from a second request and replay the first answer.
  const create = (path, body, idempotencyKey) =>
    api("POST", path, body, {
      retries: 2,
      headers: { "idempotency-key": idempotencyKey ?? randomUUID() },
    });

  // /api/agent/me, cached for the life of one command; cleared on rejection so
  // a startup race does not poison later calls in the same process.
  let mePromise;
  function me() {
    if (!mePromise) {
      mePromise = api("GET", "/api/agent/me")
        .then((r) => r.data)
        .catch((error) => {
          mePromise = undefined;
          throw error;
        });
    }
    return mePromise;
  }

  return { api, create, me };
}
