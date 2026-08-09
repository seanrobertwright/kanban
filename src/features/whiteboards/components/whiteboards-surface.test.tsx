// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  WhiteboardsButton,
  WhiteboardsWorkspace,
} from "./whiteboards-surface";

vi.mock("./whiteboard-canvas", () => ({
  createTaskCardElements: vi.fn(async () => []),
  WhiteboardCanvas: () => <div>Canvas</div>,
}));

vi.mock("@/features/board/client/api", () => ({
  fetchBoard: vi.fn(async () => ({ tasks: [] })),
}));

describe("Whiteboards workspace surface", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("requests the in-workspace surface instead of opening a modal", () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => [],
    })));
    const onOpen = vi.fn();
    window.addEventListener("kanban:open-whiteboards", onOpen);

    render(<WhiteboardsButton />);
    fireEvent.click(screen.getByRole("button", { name: "Whiteboards" }));

    expect(onOpen).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).toBeNull();
    window.removeEventListener("kanban:open-whiteboards", onOpen);
  });

  it("replaces only the board area and returns focus when closed", async () => {
    vi.stubGlobal(
      "requestAnimationFrame",
      (callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      }
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => [],
      }))
    );

    render(
      <>
        <WhiteboardsButton />
        <WhiteboardsWorkspace boardId={7} canEdit>
          <div>Board content</div>
        </WhiteboardsWorkspace>
      </>
    );
    const trigger = screen.getByRole("button", { name: "Whiteboards" });

    fireEvent.click(trigger);

    expect(
      screen.getByRole("region", { name: "Whiteboards" })
    ).not.toBeNull();
    expect(
      screen
        .getByRole("region", { name: "Whiteboards" })
        .getAttribute("data-suppress-board-shortcuts")
    ).toBe("true");
    expect(
      screen.getByText("Board content").parentElement?.getAttribute("aria-hidden")
    ).toBe("true");
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "Close whiteboards" })
    );

    expect(
      screen.queryByRole("region", { name: "Whiteboards" })
    ).toBeNull();
    expect(
      screen.getByText("Board content").parentElement?.getAttribute("aria-hidden")
    ).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("falls back to the visible trigger when the opener cannot regain focus", async () => {
    vi.stubGlobal(
      "requestAnimationFrame",
      (callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      }
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => [],
      }))
    );
    render(
      <>
        <WhiteboardsButton />
        <WhiteboardsButton />
        <WhiteboardsWorkspace boardId={7} canEdit>
          <div>Board content</div>
        </WhiteboardsWorkspace>
      </>
    );
    const [opener, fallback] = screen.getAllByRole<HTMLButtonElement>("button", {
      name: "Whiteboards",
    });
    fireEvent.click(opener);
    opener.disabled = true;

    fireEvent.click(
      screen.getByRole("button", { name: "Close whiteboards" })
    );

    await waitFor(() => expect(document.activeElement).toBe(fallback));
  });

  it("does not instruct a viewer to create an empty whiteboard", async () => {
    vi.stubGlobal(
      "requestAnimationFrame",
      (callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      }
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => [],
      }))
    );
    render(
      <>
        <WhiteboardsButton />
        <WhiteboardsWorkspace boardId={7} canEdit={false}>
          <div>Board content</div>
        </WhiteboardsWorkspace>
      </>
    );

    fireEvent.click(screen.getByRole("button", { name: "Whiteboards" }));

    expect(await screen.findByText("No whiteboards yet")).not.toBeNull();
    expect(
      screen.getByText("An editor can create the first canvas for this board.")
    ).not.toBeNull();
    expect(screen.queryByText("Create a whiteboard")).toBeNull();
  });
});
