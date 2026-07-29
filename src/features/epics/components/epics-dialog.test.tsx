// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Member } from "@/features/workspaces/types";
import { EpicsDialog } from "./epics-dialog";
import type { Epic } from "../types";

/**
 * The epic controls (089) are the part of this dialog with a wrong answer
 * available: an owner picker that posts `undefined` instead of `null`, or a
 * status select that sends a whole epic back and clears the owner on the way,
 * both look right on screen and are wrong on the wire. These cases watch the
 * requests, not the DOM.
 */

const BOARD_ID = 3;

const epic = (over: Partial<Epic> = {}): Epic => ({
  id: 11,
  boardId: BOARD_ID,
  name: "Billing",
  status: "active",
  ownerId: null,
  ownerName: null,
  createdAt: "2026-07-01T00:00:00.000Z",
  total: 4,
  done: 1,
  startDate: null,
  targetDate: null,
  ...over,
});

const members: Member[] = [
  {
    userId: "u-ada",
    name: "Ada",
    email: "ada@example.test",
    image: null,
    role: "member",
    createdAt: "2026-07-01T00:00:00.000Z",
  },
];

/**
 * The pickers are DOM-rendered selects, not native ones: options exist only
 * while the popup is open, and Base UI commits a click only when a pointerdown
 * began on that item.
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
const onChanged = vi.fn();

/** Every PATCH body, parsed — what the dialog actually asked the server for. */
function patched() {
  return fetchMock.mock.calls
    .filter(([, init]) => (init as RequestInit | undefined)?.method === "PATCH")
    .map(([url, init]) => ({
      url: String(url),
      body: JSON.parse(String((init as RequestInit).body)),
    }));
}

beforeEach(() => {
  fetchMock.mockImplementation(async () => Response.json(epic()));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
  onChanged.mockReset();
});

function renderDialog(epics: Epic[] = [epic()], canEdit = true) {
  render(
    <EpicsDialog
      open
      boardId={BOARD_ID}
      epics={epics}
      members={members}
      canEdit={canEdit}
      onOpenChange={() => {}}
      onChanged={onChanged}
    />
  );
}

describe("EpicsDialog", () => {
  it("sends only the status when the status changes", async () => {
    renderDialog([epic({ ownerId: "u-ada", ownerName: "Ada" })]);

    await openPicker("Status of Billing");
    choose("Paused");

    await waitFor(() => expect(patched()).toHaveLength(1));
    // Only the field that changed. A dialog that posts the whole epic back is
    // how a status change comes to un-own it: the wire is three-valued, and an
    // absent key is the only way to say "leave the owner alone".
    expect(patched()[0].body).toEqual({ status: "paused" });
    expect(patched()[0].url).toBe("/api/epics/11");
    expect(onChanged).toHaveBeenCalled();
  });

  it("clears the owner with an explicit null, not an absent key", async () => {
    renderDialog([epic({ ownerId: "u-ada", ownerName: "Ada" })]);

    await openPicker("Owner of Billing");
    choose("Unowned");

    await waitFor(() => expect(patched()).toHaveLength(1));
    // JSON.stringify drops undefined, so "ownerId: undefined" would reach the
    // server as an empty body and leave the epic owned — the un-own would look
    // like it worked until the next refetch put the name back.
    expect(patched()[0].body).toEqual({ ownerId: null });
    expect("ownerId" in patched()[0].body).toBe(true);
  });

  it("assigns an owner by id", async () => {
    renderDialog();

    await openPicker("Owner of Billing");
    choose("Ada");

    await waitFor(() => expect(patched()).toHaveLength(1));
    expect(patched()[0].body).toEqual({ ownerId: "u-ada" });
  });

  it("renames through the PATCH route that had no client until now", async () => {
    renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    fireEvent.change(screen.getByLabelText("Rename Billing"), {
      target: { value: "Payments" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(patched()).toHaveLength(1));
    expect(patched()[0].body).toEqual({ name: "Payments" });
  });

  it("shows each end of the derived window on its own", () => {
    // A started-but-undated epic has a start and no target, and a milestone
    // dated before anything starts has the reverse — so neither end may assume
    // the other is there.
    renderDialog([epic({ startDate: "2026-08-03", targetDate: null })]);
    expect(screen.getByText(/1\/4 done/).textContent).toMatch(/from/);
    expect(screen.getByText(/1\/4 done/).textContent).not.toMatch(/to /);
  });

  it("gives a viewer the facts and none of the controls", () => {
    renderDialog([epic({ status: "paused", ownerId: "u-ada", ownerName: "Ada" })], false);

    expect(screen.getByText("Paused · Ada")).toBeTruthy();
    expect(screen.queryByLabelText("Status of Billing")).toBeNull();
    expect(screen.queryByRole("button", { name: "Rename" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
  });
});
