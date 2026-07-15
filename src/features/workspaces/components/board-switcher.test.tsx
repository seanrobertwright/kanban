// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { BoardSwitcher } from "./board-switcher";
import type { Board, WorkspaceMembership } from "../types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const workspace: WorkspaceMembership = {
  id: "ws-1",
  name: "Alice's Workspace",
  slug: "alices-workspace-abc123",
  createdAt: "2026-07-15T00:00:00.000Z",
  role: "owner",
};

const board: Board = {
  id: 1,
  workspaceId: "ws-1",
  name: "Kanban Board",
  position: 0,
  createdAt: "2026-07-15T00:00:00.000Z",
};

function renderSwitcher(props?: Partial<React.ComponentProps<typeof BoardSwitcher>>) {
  return render(
    <BoardSwitcher
      workspaces={[workspace]}
      boards={[board]}
      currentBoardId={1}
      currentUserId="user-1"
      {...props}
    />
  );
}

/**
 * Base UI does not render popup children while closed, so a render-only
 * assertion passes even when the markup inside is broken. Every test here opens
 * the menu for real.
 */
async function openMenu() {
  const trigger = screen.getByRole("button", { name: /Kanban Board/ });
  await act(async () => {
    fireEvent.pointerDown(trigger);
    fireEvent.pointerUp(trigger);
    fireEvent.click(trigger);
  });
}

describe("BoardSwitcher", () => {
  /**
   * Guards a gap that tsc and `next build` both miss: shadcn's base-nova registry
   * builds on Base UI, where DropdownMenuLabel is Menu.GroupLabel and throws at
   * *runtime* if it has no Menu.Group ancestor. Both checks passed while this
   * component crashed the page on every render.
   */
  it("renders its menu contents without a missing MenuGroupContext", async () => {
    renderSwitcher();
    await openMenu();

    expect(screen.getByText(workspace.name)).toBeDefined();
    expect(screen.getByRole("menuitem", { name: /Kanban Board/ })).toBeDefined();
  });

  it("lists every workspace, so a second one is reachable once created", async () => {
    const second: WorkspaceMembership = {
      ...workspace,
      id: "ws-2",
      name: "Acme Inc",
      role: "member",
    };
    const secondBoard: Board = {
      ...board,
      id: 2,
      workspaceId: "ws-2",
      name: "Acme Board",
    };
    renderSwitcher({ workspaces: [workspace, second], boards: [board, secondBoard] });
    await openMenu();

    expect(screen.getByText("Acme Inc")).toBeDefined();
    expect(screen.getByRole("menuitem", { name: /Acme Board/ })).toBeDefined();
  });

  it("groups each board under its own workspace", async () => {
    const second: WorkspaceMembership = { ...workspace, id: "ws-2", name: "Acme Inc" };
    const secondBoard: Board = {
      ...board,
      id: 2,
      workspaceId: "ws-2",
      name: "Acme Board",
    };
    renderSwitcher({ workspaces: [workspace, second], boards: [board, secondBoard] });
    await openMenu();

    // Each group must contain only its own workspace's boards — a filter bug
    // would show every board under every workspace, which still "renders fine".
    const groups = screen.getAllByRole("group");
    const alice = groups.find((g) => g.textContent?.includes(workspace.name))!;
    expect(alice.textContent).toContain("Kanban Board");
    expect(alice.textContent).not.toContain("Acme Board");
  });

  it("offers New board to admins but not to members", async () => {
    renderSwitcher();
    await openMenu();
    expect(screen.getByRole("menuitem", { name: /New board/ })).toBeDefined();
  });

  it("does not offer New board to a member, who the server would refuse", async () => {
    renderSwitcher({ workspaces: [{ ...workspace, role: "member" }] });
    await openMenu();
    expect(screen.queryByRole("menuitem", { name: /New board/ })).toBeNull();
  });

  it("always offers New workspace, which needs no role", async () => {
    renderSwitcher({ workspaces: [{ ...workspace, role: "viewer" }] });
    await openMenu();
    expect(screen.getByRole("menuitem", { name: /New workspace/ })).toBeDefined();
  });
});
