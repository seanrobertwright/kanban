// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { BoardSwitcher } from "./board-switcher";
import type { Board, WorkspaceMembership } from "../types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const workspace: WorkspaceMembership = {
  id: "ws-1",
  name: "Alice's Workspace",
  slug: "alices-workspace-abc123",
  createdAt: "2026-07-15T00:00:00.000Z",
  role: "owner",
};

const boards: Board[] = [
  {
    id: 1,
    workspaceId: "ws-1",
    name: "Kanban Board",
    position: 0,
    createdAt: "2026-07-15T00:00:00.000Z",
  },
];

/**
 * Guards a gap that tsc and `next build` both miss: shadcn's base-nova registry
 * builds on Base UI, where DropdownMenuLabel is Menu.GroupLabel and throws at
 * *runtime* if it has no Menu.Group ancestor. Both checks passed while this
 * component crashed the page on every render.
 */
describe("BoardSwitcher", () => {
  it("renders its menu contents without a missing MenuGroupContext", async () => {
    render(
      <BoardSwitcher
        workspace={workspace}
        boards={boards}
        currentBoardId={1}
        currentUserId="user-1"
      />
    );

    // The menu must actually be opened: Base UI does not render popup children
    // while closed, so a render-only assertion passes even when the markup is
    // broken. Opening it is the whole point of this test.
    const trigger = screen.getByRole("button", { name: /Kanban Board/ });
    await act(async () => {
      fireEvent.pointerDown(trigger);
      fireEvent.pointerUp(trigger);
      fireEvent.click(trigger);
    });

    expect(screen.getByText(workspace.name)).toBeDefined();
    expect(screen.getByRole("menuitem", { name: /Kanban Board/ })).toBeDefined();
  });
});
