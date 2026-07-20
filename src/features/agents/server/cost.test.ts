import { describe, expect, it } from "vitest";

import { costMicros } from "./cost";

const usage = {
  inputTokens: 1000,
  outputTokens: 200,
  cacheReadTokens: 4000,
  cacheCreationTokens: 100,
};

describe("costMicros", () => {
  it("prices an opus turn at the opus rate", () => {
    // 1000*5 + 200*25 + 4000*0.5 + 100*6.25 = 5000 + 5000 + 2000 + 625
    expect(costMicros("claude-opus-4-8", usage)).toBe(12625);
  });

  it("prices a haiku turn at the (cheaper) haiku rate", () => {
    // 1000*1 + 200*5 + 4000*0.1 + 100*1.25 = 1000 + 1000 + 400 + 125
    expect(costMicros("claude-haiku-4-5", usage)).toBe(2525);
  });

  it("meters an unknown model rather than pricing it at zero", () => {
    // Unknown models fall back to opus — an unmetered run is the worse failure.
    expect(costMicros("some-future-model", usage)).toBe(
      costMicros("claude-opus-4-8", usage),
    );
  });

  it("rounds to a whole micro-dollar (the column is BIGINT)", () => {
    // 1 cache-read token on haiku = 0.1 micros, rounds to 0.
    expect(
      costMicros("claude-haiku-4-5", {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 1,
        cacheCreationTokens: 0,
      }),
    ).toBe(0);
  });
});
