// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TimeSection } from "./time-section";

/**
 * Which day a logged entry lands on (UI-3).
 *
 * The section used to send only `{minutes, note}`, leaving the server's
 * `COALESCE($4::date, CURRENT_DATE)` to answer "when" — in the *database's*
 * zone, which is UTC. Thirty minutes logged at 20:58 in New York was stored as
 * the following day, and `spent_on` is what the timesheet groups by, so the
 * evening was reported against the wrong date and a Sunday evening against the
 * wrong week.
 *
 * The reader's own date is the only defensible answer, and `useToday` already
 * computes it from local getFullYear/getMonth/getDate for this very reason.
 */

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    if (!init || init.method !== "POST") {
      return Promise.resolve(
        new Response(JSON.stringify({ entries: [], totalMinutes: 0 }), {
          headers: { "content-type": "application/json" },
        })
      );
    }
    return Promise.resolve(
      new Response(JSON.stringify({ id: 1, minutes: 30 }), {
        headers: { "content-type": "application/json" },
      })
    );
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function postBody(): Record<string, unknown> | null {
  const call = fetchMock.mock.calls.find(
    ([, init]) => (init as RequestInit | undefined)?.method === "POST"
  );
  if (!call) return null;
  return JSON.parse((call[1] as RequestInit).body as string);
}

describe("TimeSection", () => {
  it("sends the reader's own date, not the server's", async () => {
    // TZ is set for the whole run in vitest.config; assert against whatever
    // local date that moment falls on, so the test states the rule ("the
    // browser's date") rather than a hard-coded string that only holds in one
    // zone.
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const localDate = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(
      now.getDate()
    )}`;

    render(<TimeSection taskId={7} />);
    await waitFor(() => screen.getByLabelText("Minutes spent"));

    fireEvent.change(screen.getByLabelText("Minutes spent"), {
      target: { value: "30" },
    });
    fireEvent.change(screen.getByLabelText("What the time went to"), {
      target: { value: "UAT testing" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Log" }));

    await waitFor(() => expect(postBody()).not.toBeNull());
    expect(postBody()).toMatchObject({
      minutes: 30,
      note: "UAT testing",
      spentOn: localDate,
    });
  });
});
