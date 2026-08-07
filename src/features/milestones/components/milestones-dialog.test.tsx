// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Epic } from "@/features/epics/types";
import type { Milestone } from "../types";
import { MilestonesDialog } from "./milestones-dialog";

/**
 * Re-filing an existing milestone (UI-6).
 *
 * The dialog could always *choose* an epic — on the New milestone form — and
 * always *showed* the one a milestone was filed under, as a chip. What it could
 * not do was change it. A milestone created under the wrong epic, or under none,
 * had no route back except delete-and-recreate, which un-aims every task
 * pointing at it (ON DELETE SET NULL).
 *
 * The server never had this gap: updateMilestone accepts epicId and objectiveId
 * and distinguishes absent from null via `"epicId" in payload`, which is exactly
 * what unsetting one requires.
 */

const epic = (id: number, name: string): Epic =>
  ({ id, boardId: 1, name, createdAt: "2026-07-01T00:00:00.000Z" }) as Epic;

const milestone = (over: Partial<Milestone> = {}): Milestone =>
  ({
    id: 9,
    boardId: 1,
    name: "Rolling chassis",
    dueDate: "2026-09-05",
    epicId: null,
    objectiveId: null,
    createdAt: "2026-07-01T00:00:00.000Z",
    total: 1,
    done: 0,
    ...over,
  }) as Milestone;

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  fetchMock.mockImplementation(() =>
    Promise.resolve(
      new Response(JSON.stringify(milestone({ epicId: 2 })), {
        headers: { "content-type": "application/json" },
      })
    )
  );
});

afterEach(() => vi.unstubAllGlobals());

function renderDialog(over: Partial<Milestone> = {}) {
  return render(
    <MilestonesDialog
      open
      boardId={1}
      milestones={[milestone(over)]}
      epics={[epic(2, "Engine"), epic(3, "Bodywork")]}
      objectives={[]}
      canEdit
      onOpenChange={() => {}}
      onChanged={() => {}}
    />
  );
}

/**
 * The shared Base UI Select, not a native <select>: a change event on the
 * trigger is ignored, options exist only while the popup is open, and a bare
 * click on an item is discarded — Base UI honours only a click preceded by a
 * pointerdown on that same item. Lifted from admin-panels.test.tsx, which
 * learned it first.
 */
async function pick(selectLabel: RegExp | string, optionName: string) {
  fireEvent.click(screen.getByLabelText(selectLabel));
  const option = await screen.findByRole("option", { name: optionName });
  fireEvent.pointerDown(option, { pointerType: "mouse" });
  fireEvent.click(option, { detail: 1 });
  await waitFor(() => expect(screen.queryByRole("option")).toBeNull());
}

function patchBody(): Record<string, unknown> | null {
  const call = fetchMock.mock.calls.find(
    ([, init]) => (init as RequestInit | undefined)?.method === "PATCH"
  );
  return call ? JSON.parse((call[1] as RequestInit).body as string) : null;
}

describe("MilestonesDialog inline edit", () => {
  it("files an unfiled milestone under an epic", async () => {
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    await pick(/epic for rolling chassis/i, "Engine");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(patchBody()).not.toBeNull());
    expect(patchBody()).toMatchObject({ epicId: 2 });
  });

  // The half that a naive implementation drops: sending nothing for "no epic"
  // would leave the old one in place, because the server treats an absent key as
  // "unchanged" on purpose. Unfiling has to send an explicit null.
  it("unfiles a milestone by sending an explicit null", async () => {
    renderDialog({ epicId: 2 });
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    await pick(/epic for rolling chassis/i, "No epic");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(patchBody()).not.toBeNull());
    expect(patchBody()).toHaveProperty("epicId", null);
  });
});
