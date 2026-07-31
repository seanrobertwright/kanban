import { describe, expect, it } from "vitest";

import {
  DEFAULT_EVENT_LIMIT,
  MAX_EVENT_LIMIT,
  MAX_WAIT_SECONDS,
  parseEventQuery,
} from "./events";

/**
 * The feed's query contract. Worth pure tests because every one of these cases
 * is a way a caller loses events silently: a cursor that parses as a number
 * rounds, a limit that clamps instead of refusing hides a paging bug, and a
 * `since` that defaults to "the beginning" empties a context window.
 */

const parse = (qs: string) => parseEventQuery(new URLSearchParams(qs));

describe("parseEventQuery", () => {
  it("defaults to start-from-now with no backfill", () => {
    expect(parse("")).toEqual({
      query: { since: null, limit: DEFAULT_EVENT_LIMIT, waitSeconds: 0 },
    });
  });

  it("treats an empty since as absent, not as cursor zero", () => {
    // The difference matters: cursor 0 replays the board's whole history.
    expect(parse("since=")).toEqual({
      query: { since: null, limit: DEFAULT_EVENT_LIMIT, waitSeconds: 0 },
    });
  });

  it("keeps a cursor past 2^53 exactly", () => {
    const big = "9007199254740993"; // Number(big) === 9007199254740992
    expect(parse(`since=${big}`)).toEqual({
      query: { since: big, limit: DEFAULT_EVENT_LIMIT, waitSeconds: 0 },
    });
  });

  it("normalises leading zeros so the echoed cursor compares equal", () => {
    expect(parse("since=007")).toEqual({
      query: { since: "7", limit: DEFAULT_EVENT_LIMIT, waitSeconds: 0 },
    });
  });

  it.each(["1e3", "12.0", "-1", " 12", "abc", "12abc"])(
    "refuses %s as a cursor rather than guessing",
    (bad) => {
      expect(parse(`since=${encodeURIComponent(bad)}`)).toEqual({
        error: "since must be a cursor returned by a previous call",
      });
    }
  );

  it("takes a limit inside the range", () => {
    expect(parse("since=5&limit=200")).toEqual({
      query: { since: "5", limit: MAX_EVENT_LIMIT, waitSeconds: 0 },
    });
  });

  it.each(["0", "201", "1.5", "abc", "-5"])(
    "refuses limit %s instead of clamping it",
    (bad) => {
      expect(parse(`limit=${bad}`)).toEqual({
        error: `limit must be an integer between 1 and ${MAX_EVENT_LIMIT}`,
      });
    }
  );

  it("clamps an over-long wait to the proxy-safe ceiling", () => {
    expect(parse("since=1&wait=600")).toEqual({
      query: { since: "1", limit: DEFAULT_EVENT_LIMIT, waitSeconds: MAX_WAIT_SECONDS },
    });
  });

  it("clamps a negative wait to zero", () => {
    expect(parse("since=1&wait=-3")).toEqual({
      query: { since: "1", limit: DEFAULT_EVENT_LIMIT, waitSeconds: 0 },
    });
  });

  it("keeps a fractional wait — sub-second polling is a legal preference", () => {
    expect(parse("since=1&wait=0.5")).toEqual({
      query: { since: "1", limit: DEFAULT_EVENT_LIMIT, waitSeconds: 0.5 },
    });
  });

  it("refuses a wait that is not a number, where clamping has nothing to clamp", () => {
    expect(parse("wait=soon")).toEqual({ error: "wait must be a number of seconds" });
  });
});
