// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MembersDialog } from "./members-dialog";
import type { WorkspaceMembership } from "../types";

const { fetchMembers, inviteMember, removeMember } = vi.hoisted(() => ({
  fetchMembers: vi.fn(),
  inviteMember: vi.fn(),
  removeMember: vi.fn(),
}));

vi.mock("../client/api", () => ({
  fetchMembers,
  inviteMember,
  removeMember,
  updateMemberRole: vi.fn(),
  revokeInvitation: vi.fn(),
}));

const workspace = (role: WorkspaceMembership["role"]): WorkspaceMembership => ({
  id: "ws-1",
  name: "Alice's Workspace",
  slug: "alices-workspace-abc123",
  createdAt: "2026-07-15T00:00:00.000Z",
  role,
});

const roster = {
  members: [
    {
      userId: "u-alice",
      name: "Alice",
      email: "alice@example.test",
      image: null,
      role: "owner" as const,
      createdAt: "2026-07-15T00:00:00.000Z",
    },
    {
      userId: "u-bob",
      name: "Bob",
      email: "bob@example.test",
      image: null,
      role: "member" as const,
      createdAt: "2026-07-15T00:00:00.000Z",
    },
  ],
  invitations: [
    {
      id: "inv-1",
      workspaceId: "ws-1",
      email: "carol@example.test",
      role: "viewer" as const,
      createdAt: "2026-07-15T00:00:00.000Z",
      expiresAt: "2026-07-29T00:00:00.000Z",
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  fetchMembers.mockResolvedValue(roster);
});

describe("MembersDialog", () => {
  it("lists members and pending invitations for an admin", async () => {
    render(
      <MembersDialog
        open
        onOpenChange={vi.fn()}
        workspace={workspace("owner")}
        currentUserId="u-alice"
      />
    );

    expect(await screen.findByText("Bob")).toBeDefined();
    expect(screen.getByText("carol@example.test")).toBeDefined();
    expect(screen.getByLabelText("Invite by email")).toBeDefined();
  });

  it("hides the invite form from a viewer", async () => {
    render(
      <MembersDialog
        open
        onOpenChange={vi.fn()}
        workspace={workspace("viewer")}
        currentUserId="u-bob"
      />
    );

    expect(await screen.findByText("Bob")).toBeDefined();
    expect(screen.queryByLabelText("Invite by email")).toBeNull();
    // A viewer sees roles as text, with no way to change them.
    expect(screen.queryByLabelText("Role for Bob")).toBeNull();
  });

  it("surfaces the server's refusal instead of swallowing it", async () => {
    // The last-owner rule is enforced server-side; the user must see why.
    removeMember.mockRejectedValue(
      new Error("Cannot leave as the last owner of this workspace.")
    );
    render(
      <MembersDialog
        open
        onOpenChange={vi.fn()}
        workspace={workspace("owner")}
        currentUserId="u-alice"
      />
    );

    fireEvent.click(await screen.findByRole("button", { name: "Leave workspace" }));

    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Cannot leave as the last owner of this workspace."
    );
  });

  it("sends an invite and refreshes the roster", async () => {
    inviteMember.mockResolvedValue(roster.invitations[0]);
    render(
      <MembersDialog
        open
        onOpenChange={vi.fn()}
        workspace={workspace("owner")}
        currentUserId="u-alice"
      />
    );

    fireEvent.change(await screen.findByLabelText("Invite by email"), {
      target: { value: "dave@example.test" },
    });
    fireEvent.change(screen.getByLabelText("Invite role"), {
      target: { value: "admin" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Invite" }));

    await waitFor(() =>
      expect(inviteMember).toHaveBeenCalledWith("ws-1", "dave@example.test", "admin")
    );
    // Reloaded, so a redeemed invite cannot linger in the list.
    await waitFor(() => expect(fetchMembers).toHaveBeenCalledTimes(2));
  });
});
