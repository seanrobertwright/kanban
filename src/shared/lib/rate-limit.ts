/**
 * In-memory token bucket for the anonymous `api/public/**` doors (SPEC 3.9).
 * Keyed per IP+token so one scraper cannot starve everyone else's link, and
 * dependency-free on purpose: a single-process limiter is honest about what a
 * single-process deployment can enforce. State resets on restart — acceptable,
 * these routes are reads and one-task submits, not billing.
 */
type Bucket = { tokens: number; last: number };
const buckets = new Map<string, Bucket>();
/** Oldest-first eviction cap so a token-guessing sweep cannot grow the map unboundedly. */
const MAX_BUCKETS = 10_000;

export interface RateLimitOptions {
  /** Burst size — requests allowed instantly from cold. */
  capacity?: number;
  /** Sustained refill, tokens per second. */
  refillPerSecond?: number;
}

export function takeToken(
  key: string,
  { capacity = 20, refillPerSecond = 0.5 }: RateLimitOptions = {},
  now = Date.now()
): { ok: true } | { ok: false; retryAfterSeconds: number } {
  let bucket = buckets.get(key);
  if (!bucket) {
    if (buckets.size >= MAX_BUCKETS) {
      const oldest = buckets.keys().next().value;
      if (oldest !== undefined) buckets.delete(oldest);
    }
    bucket = { tokens: capacity, last: now };
    buckets.set(key, bucket);
  }
  bucket.tokens = Math.min(
    capacity,
    bucket.tokens + ((now - bucket.last) / 1000) * refillPerSecond
  );
  bucket.last = now;
  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return { ok: true };
  }
  return {
    ok: false,
    retryAfterSeconds: Math.max(1, Math.ceil((1 - bucket.tokens) / refillPerSecond)),
  };
}

/** Test hook — each vitest file gets a fresh process, but keep it explicit. */
export function resetRateLimits() {
  buckets.clear();
}

/**
 * The guard the public route handlers call first: null to proceed, or the 429
 * to return. Keyed on the caller's IP (first x-forwarded-for hop — what the
 * fronting proxy stamped) plus the capability token being exercised.
 */
export function publicRateLimit(
  request: Request,
  token: string,
  options?: RateLimitOptions
): Response | null {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "local";
  const result = takeToken(`public:${ip}:${token}`, options);
  if (result.ok) return null;
  return Response.json(
    { error: "Too many requests" },
    { status: 429, headers: { "Retry-After": String(result.retryAfterSeconds) } }
  );
}
