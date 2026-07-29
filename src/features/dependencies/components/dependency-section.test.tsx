// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DependencySection } from "./dependency-section";
import type { TaskDependencies } from "../types";

/**
 * The link controls (087) are the part of this section with a wrong answer
 * available: a type select that writes the wrong edge, or a lag box that posts
 * once per keystroke, both look fine on screen and are wrong on the wire. These
 * cases watch the requests rather than the DOM.
 */

const TASK_ID = 10;

const payload = (over: Partial<TaskDependencies> = {}): TaskDependencies => ({
  dependencies: [{ id: 7, title: "The blocker", type: "FS", lagDays: 0 }],
  candidates: [{ id: 8, title: "Another task" }],
  ...over,
});

/**
 * The pickers are DOM-rendered selects, not native ones (the task dialog's tests
 * say the same): options exist only while the popup is open, and Base UI commits
 * a click only when a pointerdown began on that item.
 */
async function openPicker(label: string) {
  fireEvent.click(screen.getByLabelText(label));
  await waitFor(() =>
    expect(screen.getAllByRole("option").length).toBeGreaterThan(0)
  );
}

function choose(name: string | RegExp) {
  const option = screen.getByRole("option", { name });
  fireEvent.pointerDown(option, { pointerType: "mouse" });
  fireEvent.click(option, { detail: 1 });
}

const fetchMock = vi.fn();

/** Every POST /dependencies body, parsed — what the section actually asked for. */
function posted() {
  return fetchMock.mock.calls
    .filter(([, init]) => (init as RequestInit | undefined)?.method === "POST")
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)));
}

beforeEach(() => {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST" || init?.method === "DELETE")
      return new Response(null, { status: 204 });
    return Response.json(payload());
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

async function renderSection() {
  render(<DependencySection taskId={TASK_ID} />);
  return (await screen.findByLabelText(
    'Lag in days for "The blocker"'
  )) as HTMLInputElement;
}

describe("DependencySection links", () => {
  it("shows the link a blocker already has", async () => {
    fetchMock.mockImplementation(async () =>
      Response.json(
        payload({
          dependencies: [
            { id: 7, title: "The blocker", type: "SS", lagDays: -2 },
          ],
        })
      )
    );
    const lag = await renderSection();

    expect(lag.value).toBe("-2");
    expect(
      screen.getByLabelText('Link type for "The blocker"').textContent
    ).toContain("Start → start");
  });

  it("changes the type through the same add endpoint, which upserts", async () => {
    // No second route and no delete-then-recreate: the pair is the primary key,
    // so re-stating it IS the edit. A delete would briefly unblock the task.
    await renderSection();

    await openPicker('Link type for "The blocker"');
    choose("Finish → finish");

    await waitFor(() => expect(posted()).toHaveLength(1));
    expect(posted()[0]).toEqual({ dependsOnId: 7, type: "FF", lagDays: 0 });
  });

  it("posts the lag once, on blur, not once per keystroke", async () => {
    const lag = await renderSection();

    // Typing 12 passes through 1; a request per keystroke would tell the server
    // the link is one day before telling it it is twelve.
    fireEvent.change(lag, { target: { value: "1" } });
    fireEvent.change(lag, { target: { value: "12" } });
    expect(posted()).toHaveLength(0);

    fireEvent.blur(lag);

    await waitFor(() => expect(posted()).toHaveLength(1));
    expect(posted()[0]).toEqual({ dependsOnId: 7, type: "FS", lagDays: 12 });
  });

  it("reverts an empty or out-of-range lag instead of writing it", async () => {
    const lag = await renderSection();

    // Clearing the box to retype is not "no lag", and a year-and-a-bit is the
    // schema's refusal — neither should reach the server.
    fireEvent.change(lag, { target: { value: "" } });
    fireEvent.blur(lag);
    expect(lag.value).toBe("0");

    fireEvent.change(lag, { target: { value: "9999" } });
    fireEvent.blur(lag);
    expect(lag.value).toBe("0");
    expect(posted()).toHaveLength(0);
  });

  it("does not post when the committed lag is what it already was", async () => {
    const lag = await renderSection();

    fireEvent.change(lag, { target: { value: "5" } });
    fireEvent.change(lag, { target: { value: "0" } });
    fireEvent.blur(lag);

    expect(posted()).toHaveLength(0);
  });

  it("adds a new blocker with no link, which the server reads as FS/0", async () => {
    await renderSection();

    await openPicker("Add a blocking task");
    choose("Another task");
    fireEvent.click(screen.getByLabelText("Add dependency"));

    await waitFor(() => expect(posted()).toHaveLength(1));
    // No type/lagDays keys at all — an add that names no link must send the
    // request 018 sent, so the server's default is the one thing deciding.
    expect(posted()[0]).toEqual({ dependsOnId: 8 });
  });
});
