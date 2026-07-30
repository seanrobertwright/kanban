import { describe, expect, it } from "vitest";

import { claimLapsed, holdLabel, type ClaimView } from "./claim";

/**
 * The lease as a reader sees it. Pure, and `now` is a parameter rather than the
 * wall clock, so "the moment the lease runs out" is a case that can be written
 * down instead of waited for.
 */
const held = (over: Partial<ClaimView> = {}): ClaimView => ({
  claimedBy: { type: "agent", id: "agent-1" },
  claimExpiresAt: "2026-07-30T12:00:00.000Z",
  ...over,
});

const at = (iso: string) => new Date(iso).getTime();

describe("claimLapsed", () => {
  it("is false while the lease has time left", () => {
    expect(claimLapsed(held(), at("2026-07-30T11:59:59.000Z"))).toBe(false);
  });

  it("is true once the expiry has passed", () => {
    expect(claimLapsed(held(), at("2026-07-30T12:00:01.000Z"))).toBe(true);
  });

  it("holds the lease at the exact expiry instant", () => {
    // The boundary matches the server's `claim_expires_at < now()`: a lease is
    // over when the clock is *past* it, not when it reaches it. A reader that
    // rounded the other way would show a hold as free one tick before the
    // repository would let anyone take it.
    expect(claimLapsed(held(), at("2026-07-30T12:00:00.000Z"))).toBe(false);
  });

  it("never lapses a hold with no expiry", () => {
    // A pre-076 claim means "held until released". Reading a null expiry as
    // "expired" would free every hold taken before the migration on the day it
    // ran, which is the one thing 076's nullable column exists to prevent.
    expect(
      claimLapsed(held({ claimExpiresAt: null }), at("2099-01-01T00:00:00.000Z"))
    ).toBe(false);
  });

  it("is false for a free task even if an expiry somehow lingers", () => {
    // The database's CHECK forbids this row, so the guard is not for data we
    // expect — it is so that "lapsed" always implies "there was a hold", which
    // is what every caller reads it as.
    expect(
      claimLapsed(
        { claimedBy: null, claimExpiresAt: "2020-01-01T00:00:00.000Z" },
        at("2026-07-30T12:00:00.000Z")
      )
    ).toBe(false);
  });
});

describe("holdLabel", () => {
  it("names an agent's live hold", () => {
    expect(holdLabel(held(), at("2026-07-30T11:00:00.000Z"))).toBe(
      "An agent is working on this"
    );
  });

  it("keeps naming the holder after the lease lapses", () => {
    // Not "unclaimed": who was working it is the fact a reader picking the task
    // back up actually needs, and the live label would be a lie.
    const label = holdLabel(held(), at("2026-07-30T13:00:00.000Z"));
    expect(label).toContain("An agent");
    expect(label).toContain("lapsed");
  });

  it("distinguishes a human's hold from an agent's", () => {
    const human = held({ claimedBy: { type: "human", id: "u1" } });
    expect(holdLabel(human, at("2026-07-30T11:00:00.000Z"))).toBe(
      "Being worked on"
    );
    expect(holdLabel(human, at("2026-07-30T13:00:00.000Z"))).toContain("Someone");
  });

  it("says nothing about a free task", () => {
    expect(holdLabel({ claimedBy: null, claimExpiresAt: null })).toBe("");
  });
});
