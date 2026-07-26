import { beforeEach, describe, expect, it } from "vitest";

import { publicRateLimit, resetRateLimits, takeToken } from "./rate-limit";

describe("token bucket", () => {
  beforeEach(() => resetRateLimits());

  it("allows a burst up to capacity, then refuses with a retry hint", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 5; i++) {
      expect(takeToken("k", { capacity: 5, refillPerSecond: 1 }, t0).ok).toBe(true);
    }
    const refused = takeToken("k", { capacity: 5, refillPerSecond: 1 }, t0);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  it("refills over time", () => {
    const t0 = 1_000_000;
    const opts = { capacity: 2, refillPerSecond: 1 };
    expect(takeToken("r", opts, t0).ok).toBe(true);
    expect(takeToken("r", opts, t0).ok).toBe(true);
    expect(takeToken("r", opts, t0).ok).toBe(false);
    // Two seconds later the bucket has refilled enough for one more.
    expect(takeToken("r", opts, t0 + 2_000).ok).toBe(true);
  });

  it("isolates keys — one caller cannot starve another", () => {
    const t0 = 1_000_000;
    const opts = { capacity: 1, refillPerSecond: 0.1 };
    expect(takeToken("a", opts, t0).ok).toBe(true);
    expect(takeToken("a", opts, t0).ok).toBe(false);
    expect(takeToken("b", opts, t0).ok).toBe(true);
  });
});

describe("publicRateLimit", () => {
  beforeEach(() => resetRateLimits());

  const req = (ip: string) =>
    new Request("http://test/api/public/forms/tok", {
      headers: { "x-forwarded-for": ip },
    });

  it("returns null while allowed, then a 429 with Retry-After", () => {
    const opts = { capacity: 2, refillPerSecond: 0.1 };
    expect(publicRateLimit(req("1.2.3.4"), "tok", opts)).toBeNull();
    expect(publicRateLimit(req("1.2.3.4"), "tok", opts)).toBeNull();
    const limited = publicRateLimit(req("1.2.3.4"), "tok", opts);
    expect(limited?.status).toBe(429);
    expect(Number(limited?.headers.get("Retry-After"))).toBeGreaterThan(0);
    // A different IP exercising the same token still gets through.
    expect(publicRateLimit(req("5.6.7.8"), "tok", opts)).toBeNull();
  });
});
