// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ShareDialog } from "./share-dialog";

const {
  fetchPublicLinks,
  fetchObjectShares,
  mintPublicLink,
  revokePublicLink,
  grantObjectShare,
  revokeObjectShare,
  fetchMembers,
} = vi.hoisted(() => ({
  fetchPublicLinks: vi.fn(),
  fetchObjectShares: vi.fn(),
  mintPublicLink: vi.fn(),
  revokePublicLink: vi.fn(),
  grantObjectShare: vi.fn(),
  revokeObjectShare: vi.fn(),
  fetchMembers: vi.fn(),
}));

vi.mock("../client/api", () => ({
  fetchPublicLinks,
  fetchObjectShares,
  mintPublicLink,
  revokePublicLink,
  grantObjectShare,
  revokeObjectShare,
}));

vi.mock("@/features/workspaces/client/api", () => ({ fetchMembers }));

const links = [
  {
    id: 11,
    token: "tok-abc",
    scope: "read" as const,
    expiresAt: null,
    createdAt: "2026-07-20T00:00:00.000Z",
  },
];

const shares = [
  {
    userId: "u-guest",
    name: "Gwen Guest",
    email: "gwen@example.test",
    canEdit: false,
    createdAt: "2026-07-20T00:00:00.000Z",
  },
];

const roster = {
  members: [
    {
      userId: "u-guest",
      name: "Gwen Guest",
      email: "gwen@example.test",
      image: null,
      role: "guest" as const,
      createdAt: "2026-07-15T00:00:00.000Z",
    },
    {
      userId: "u-vic",
      name: "Vic Viewer",
      email: "vic@example.test",
      image: null,
      role: "viewer" as const,
      createdAt: "2026-07-15T00:00:00.000Z",
    },
  ],
  invitations: [],
};

function renderDialog() {
  return render(
    <ShareDialog
      open
      onOpenChange={vi.fn()}
      subjectType="board"
      subjectId="7"
      subjectName="Roadmap"
      workspaceId="ws-1"
    />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchPublicLinks.mockResolvedValue(links);
  fetchObjectShares.mockResolvedValue(shares);
  fetchMembers.mockResolvedValue(roster);
});

describe("ShareDialog", () => {
  it("lists existing public links and guest shares", async () => {
    renderDialog();

    expect(await screen.findByText("/public/boards/tok-abc")).toBeDefined();
    expect(screen.getByText("no expiry")).toBeDefined();
    expect(screen.getByText("Gwen Guest")).toBeDefined();
    expect(screen.getByText("read-only")).toBeDefined();
    expect(fetchPublicLinks).toHaveBeenCalledWith("board", "7");
    expect(fetchObjectShares).toHaveBeenCalledWith("board", "7");
  });

  it("mints a read link with no expiry and reloads", async () => {
    mintPublicLink.mockResolvedValue({ id: 12, token: "tok-new" });
    renderDialog();

    fireEvent.click(await screen.findByRole("button", { name: "Create link" }));

    await waitFor(() =>
      expect(mintPublicLink).toHaveBeenCalledWith("board", "7", "read", null)
    );
    await waitFor(() => expect(fetchPublicLinks).toHaveBeenCalledTimes(2));
  });

  it("mints with an expiry when days are given", async () => {
    mintPublicLink.mockResolvedValue({ id: 13, token: "tok-exp" });
    renderDialog();

    fireEvent.change(await screen.findByLabelText("Expires in days (blank = never)"), {
      target: { value: "7" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create link" }));

    await waitFor(() => expect(mintPublicLink).toHaveBeenCalled());
    const expiresAt = mintPublicLink.mock.calls[0][3] as string;
    // Roughly seven days out — the exact millisecond depends on the clock.
    const days = (new Date(expiresAt).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThan(7.1);
  });

  it("revokes a public link", async () => {
    revokePublicLink.mockResolvedValue(undefined);
    renderDialog();

    fireEvent.click(await screen.findByRole("button", { name: "Revoke link 11" }));

    await waitFor(() => expect(revokePublicLink).toHaveBeenCalledWith(11));
  });

  it("grants a guest share to a chosen member", async () => {
    grantObjectShare.mockResolvedValue(undefined);
    renderDialog();

    // Gwen already holds a share, so the picker offers only Vic.
    fireEvent.click(await screen.findByLabelText("Share with member"));
    expect(screen.queryByRole("option", { name: "Gwen Guest (gwen@example.test)" })).toBeNull();
    const vic = await screen.findByRole("option", { name: "Vic Viewer (vic@example.test)" });
    // A DOM-rendered select: Base UI commits a click only when a pointerdown
    // began on that same item.
    fireEvent.pointerDown(vic, { pointerType: "mouse" });
    fireEvent.click(vic, { detail: 1 });
    fireEvent.click(screen.getByLabelText("Grant edit access"));
    fireEvent.click(screen.getByRole("button", { name: "Share" }));

    await waitFor(() =>
      expect(grantObjectShare).toHaveBeenCalledWith("board", "7", "u-vic", true)
    );
    await waitFor(() => expect(fetchObjectShares).toHaveBeenCalledTimes(2));
  });

  it("revokes a guest share", async () => {
    revokeObjectShare.mockResolvedValue(undefined);
    renderDialog();

    fireEvent.click(
      await screen.findByRole("button", { name: "Revoke access for Gwen Guest" })
    );

    await waitFor(() =>
      expect(revokeObjectShare).toHaveBeenCalledWith("board", "7", "u-guest")
    );
  });

  it("surfaces the server's refusal instead of swallowing it", async () => {
    mintPublicLink.mockRejectedValue(new Error("Your role (member) cannot act in this workspace; requires admin or higher."));
    renderDialog();

    fireEvent.click(await screen.findByRole("button", { name: "Create link" }));

    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Your role (member) cannot act in this workspace; requires admin or higher."
    );
  });
});
