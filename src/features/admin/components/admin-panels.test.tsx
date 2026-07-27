// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Board, WorkspaceMembership } from "@/features/workspaces/types";
import { AuditLogPanel } from "./audit-log-panel";
import { EmailIntakePanel } from "./email-intake-panel";
import { PermissionsPanel } from "./permissions-panel";
import { SecurityPanel } from "./security-panel";
import { WorkspaceOverviewPanel } from "./workspace-overview-panel";

/**
 * The five sections the admin console became. Each one used to be a slab of a
 * single 5,000-character line inside a modal that opened three further modals,
 * and none of it had a rendering test.
 *
 * These are role and wiring tests, not snapshot tests: a panel's job is to show
 * what the server returned, to send the right write, and — for the allowlist —
 * to offer the form only to the rank the server would accept it from.
 */

const {
  fetchAdminSummary,
  fetchBoardGrants,
  fetchFieldPolicies,
  fetchAuditLog,
  fetchEmailIntake,
  fetchIpAllowlist,
  grantBoardPermission,
  revokeBoardGrant,
  saveFieldPolicy,
  deleteFieldPolicy,
  addIpAllowlistEntry,
  deleteIpAllowlistEntry,
  fetchBoardFields,
} = vi.hoisted(() => ({
  fetchAdminSummary: vi.fn(),
  fetchBoardGrants: vi.fn(),
  fetchFieldPolicies: vi.fn(),
  fetchAuditLog: vi.fn(),
  fetchEmailIntake: vi.fn(),
  fetchIpAllowlist: vi.fn(),
  grantBoardPermission: vi.fn(),
  revokeBoardGrant: vi.fn(),
  saveFieldPolicy: vi.fn(),
  deleteFieldPolicy: vi.fn(),
  addIpAllowlistEntry: vi.fn(),
  deleteIpAllowlistEntry: vi.fn(),
  fetchBoardFields: vi.fn(),
}));

vi.mock("@/features/workspaces/client/api", () => ({
  fetchAdminSummary,
  fetchBoardGrants,
  fetchFieldPolicies,
  fetchAuditLog,
  fetchEmailIntake,
  fetchIpAllowlist,
  grantBoardPermission,
  revokeBoardGrant,
  saveFieldPolicy,
  deleteFieldPolicy,
  addIpAllowlistEntry,
  deleteIpAllowlistEntry,
  // EnterpriseControls, which SecurityPanel hosts, loads these on mount.
  fetchRetentionPolicies: vi.fn(async () => []),
  fetchLegalHolds: vi.fn(async () => []),
  fetchIdentityProviders: vi.fn(async () => []),
  fetchIntegrations: vi.fn(async () => []),
  fetchExtensions: vi.fn(async () => []),
}));

vi.mock("@/features/custom-fields/client/api", () => ({ fetchBoardFields }));


/**
 * The Selects here are the shared Base UI wrapper, not native <select>: a
 * change event on the trigger is ignored, and options exist only while the
 * popup is open. Base UI also discards a bare click on an item — it honours
 * only a click preceded by a pointerdown on that same item.
 */
async function pick(selectLabel: string, optionName: string) {
  fireEvent.click(screen.getByLabelText(selectLabel));
  const option = await screen.findByRole("option", { name: optionName });
  fireEvent.pointerDown(option, { pointerType: "mouse" });
  fireEvent.click(option, { detail: 1 });
  await waitFor(() => expect(screen.queryByRole("option")).toBeNull());
}

const workspace = (
  role: WorkspaceMembership["role"] = "owner"
): WorkspaceMembership => ({
  id: "ws-1",
  name: "Alice's Workspace",
  slug: "alices-workspace-abc123",
  createdAt: "2026-07-15T00:00:00.000Z",
  role,
});

const boards: Board[] = [
  {
    id: 1,
    workspaceId: "ws-1",
    name: "Delivery",
    position: 0,
    createdAt: "2026-07-15T00:00:00.000Z",
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  fetchAdminSummary.mockResolvedValue({
    members: 3,
    agents: 2,
    boards: 1,
    webhooks: 0,
    auditEvents: 41,
  });
  fetchBoardGrants.mockResolvedValue([]);
  fetchFieldPolicies.mockResolvedValue([]);
  fetchAuditLog.mockResolvedValue([]);
  fetchEmailIntake.mockResolvedValue({ configured: false, addresses: [] });
  fetchIpAllowlist.mockResolvedValue([]);
  fetchBoardFields.mockResolvedValue([]);
});

describe("WorkspaceOverviewPanel", () => {
  it("shows the counts the summary returned", async () => {
    render(<WorkspaceOverviewPanel workspace={workspace()} />);
    expect(await screen.findByText("41")).toBeDefined();
    expect(screen.getByText("Audit events")).toBeDefined();
    expect(screen.getByText("3")).toBeDefined();
  });

  it("shows a dash rather than a zero before the numbers arrive", () => {
    // A zero would be a claim; a dash is the truth while loading.
    fetchAdminSummary.mockReturnValue(new Promise(() => {}));
    render(<WorkspaceOverviewPanel workspace={workspace()} />);
    expect(screen.getAllByText("—").length).toBe(5);
  });
});

describe("PermissionsPanel", () => {
  it("lists both grant kinds and says so when there are none", async () => {
    render(<PermissionsPanel workspace={workspace()} boards={boards} />);
    await waitFor(() => expect(fetchBoardGrants).toHaveBeenCalled());
    expect(await screen.findByText(/No board permissions/)).toBeDefined();
    expect(screen.getByText(/No field policies/)).toBeDefined();
  });

  it("names the board a grant is on rather than showing a bare id", async () => {
    fetchBoardGrants.mockResolvedValue([
      {
        id: "g-1",
        workspaceId: "ws-1",
        subjectType: "board",
        subjectId: "1",
        principalType: "workspace_role",
        principalId: "viewer",
        capability: "read",
        createdAt: "2026-07-20T00:00:00.000Z",
      },
    ]);
    render(<PermissionsPanel workspace={workspace()} boards={boards} />);
    expect(await screen.findByText(/Delivery: viewer → read/)).toBeDefined();
  });

  it("sends the chosen board, role and capability, then reloads", async () => {
    grantBoardPermission.mockResolvedValue({});
    render(<PermissionsPanel workspace={workspace()} boards={boards} />);
    await waitFor(() => expect(fetchBoardGrants).toHaveBeenCalledTimes(1));

    await pick("Board", "Delivery");
    fireEvent.click(screen.getByRole("button", { name: "Grant" }));

    await waitFor(() =>
      expect(grantBoardPermission).toHaveBeenCalledWith("ws-1", {
        subjectId: "1",
        principalType: "workspace_role",
        principalId: "guest",
        capability: "read",
      })
    );
    // The list must re-read: a write that only updated local state would drift
    // from whatever the server actually stored.
    await waitFor(() => expect(fetchBoardGrants).toHaveBeenCalledTimes(2));
  });

  it("will not send a grant before a board is chosen", async () => {
    render(<PermissionsPanel workspace={workspace()} boards={boards} />);
    await waitFor(() => expect(fetchBoardGrants).toHaveBeenCalled());
    expect(
      screen.getByRole("button", { name: "Grant" }).hasAttribute("disabled")
    ).toBe(true);
  });

  it("loads a board's fields when that board is picked, not before", async () => {
    fetchBoardFields.mockResolvedValue([
      { id: 7, boardId: 1, name: "Salary", type: "text", options: [], position: 0 },
    ]);
    render(<PermissionsPanel workspace={workspace()} boards={boards} />);
    await waitFor(() => expect(fetchFieldPolicies).toHaveBeenCalled());
    expect(fetchBoardFields).not.toHaveBeenCalled();

    await pick("Policy board", "Delivery");
    await waitFor(() => expect(fetchBoardFields).toHaveBeenCalledWith(1));

    // The picked board's fields are now the field picker's options.
    fireEvent.click(screen.getByLabelText("Policy field"));
    expect(await screen.findByRole("option", { name: "Salary" })).toBeDefined();
  });

  it("translates the access choice into the canView/canEdit pair SQL enforces", async () => {
    fetchBoardFields.mockResolvedValue([
      { id: 7, boardId: 1, name: "Salary", type: "text", options: [], position: 0 },
    ]);
    saveFieldPolicy.mockResolvedValue({});
    render(<PermissionsPanel workspace={workspace()} boards={boards} />);
    await waitFor(() => expect(fetchFieldPolicies).toHaveBeenCalled());

    await pick("Policy board", "Delivery");
    await waitFor(() => expect(fetchBoardFields).toHaveBeenCalled());
    await pick("Policy field", "Salary");
    await pick("Policy access", "hidden");
    fireEvent.click(screen.getByRole("button", { name: "Set" }));

    await waitFor(() =>
      expect(saveFieldPolicy).toHaveBeenCalledWith("ws-1", {
        fieldId: 7,
        role: "guest",
        canView: false,
        canEdit: false,
      })
    );
  });

  it("shows the server's sentence when a write is refused", async () => {
    grantBoardPermission.mockRejectedValue(new Error("Board not found"));
    render(<PermissionsPanel workspace={workspace()} boards={boards} />);
    await waitFor(() => expect(fetchBoardGrants).toHaveBeenCalled());

    await pick("Board", "Delivery");
    fireEvent.click(screen.getByRole("button", { name: "Grant" }));

    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Board not found"
    );
  });

  it("revokes the grant it is sitting next to", async () => {
    fetchBoardGrants.mockResolvedValue([
      {
        id: "g-1",
        workspaceId: "ws-1",
        subjectType: "board",
        subjectId: "1",
        principalType: "workspace_role",
        principalId: "viewer",
        capability: "read",
        createdAt: "2026-07-20T00:00:00.000Z",
      },
    ]);
    revokeBoardGrant.mockResolvedValue(undefined);
    render(<PermissionsPanel workspace={workspace()} boards={boards} />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Revoke board permission" })
    );
    await waitFor(() =>
      expect(revokeBoardGrant).toHaveBeenCalledWith("ws-1", "g-1")
    );
  });

  it("removes a field policy by field and role, which is its key", async () => {
    fetchFieldPolicies.mockResolvedValue([
      {
        fieldId: 7,
        fieldName: "Salary",
        boardId: 1,
        role: "member",
        canView: true,
        canEdit: false,
      },
    ]);
    deleteFieldPolicy.mockResolvedValue(undefined);
    render(<PermissionsPanel workspace={workspace()} boards={boards} />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Remove Salary policy for member" })
    );
    await waitFor(() =>
      expect(deleteFieldPolicy).toHaveBeenCalledWith("ws-1", 7, "member")
    );
  });
});

describe("AuditLogPanel", () => {
  const event = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    boardId: 1,
    taskId: null,
    actorType: "human" as const,
    actorId: "u-alice",
    actorName: "Alice",
    action: "task.created",
    createdAt: "2026-07-20T10:00:00.000Z",
    ...over,
  });

  it("reads the first page on open", async () => {
    render(<AuditLogPanel workspace={workspace()} boards={boards} />);
    await waitFor(() => expect(fetchAuditLog).toHaveBeenCalledWith("ws-1", 25, 0));
  });

  it("names the actor and the board rather than echoing ids", async () => {
    fetchAuditLog.mockResolvedValue([event("1")]);
    render(<AuditLogPanel workspace={workspace()} boards={boards} />);
    const row = await screen.findByText(/task.created/);
    expect(row.textContent).toContain("Alice");
    expect(row.textContent).toContain("Delivery");
  });

  it("falls back to the raw actor when the account is gone", async () => {
    fetchAuditLog.mockResolvedValue([
      event("1", { actorName: null, actorType: "agent", actorId: "agent-7" }),
    ]);
    render(<AuditLogPanel workspace={workspace()} boards={boards} />);
    expect((await screen.findByText(/task.created/)).textContent).toContain(
      "agent agent-7"
    );
  });

  it("pages by offset, and cannot go newer than the first page", async () => {
    fetchAuditLog.mockResolvedValue(
      Array.from({ length: 25 }, (_, i) => event(String(i + 1)))
    );
    render(<AuditLogPanel workspace={workspace()} boards={boards} />);
    await waitFor(() => expect(fetchAuditLog).toHaveBeenCalledTimes(1));

    expect(
      screen.getByRole("button", { name: "Newer" }).hasAttribute("disabled")
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Older" }));
    await waitFor(() => expect(fetchAuditLog).toHaveBeenCalledWith("ws-1", 25, 25));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Newer" }).hasAttribute("disabled")
      ).toBe(false)
    );
  });

  it("stops offering Older once a short page comes back", async () => {
    fetchAuditLog.mockResolvedValue([event("1")]);
    render(<AuditLogPanel workspace={workspace()} boards={boards} />);
    await screen.findByText(/task.created/);
    expect(
      screen.getByRole("button", { name: "Older" }).hasAttribute("disabled")
    ).toBe(true);
  });
});

describe("EmailIntakePanel", () => {
  it("says the deployment has no gateway rather than showing nothing", async () => {
    render(<EmailIntakePanel workspace={workspace()} />);
    expect(
      await screen.findByText(/no inbound mail gateway configured/)
    ).toBeDefined();
  });

  it("shows each board's address once intake is configured", async () => {
    fetchEmailIntake.mockResolvedValue({
      configured: true,
      addresses: [
        { boardId: 1, boardName: "Delivery", address: "board-1@intake.test" },
      ],
    });
    render(<EmailIntakePanel workspace={workspace()} />);
    expect(await screen.findByText("board-1@intake.test")).toBeDefined();
  });

  it("copies the address and says it did", async () => {
    const writeText = vi.fn(async () => {});
    Object.assign(navigator, { clipboard: { writeText } });
    fetchEmailIntake.mockResolvedValue({
      configured: true,
      addresses: [
        { boardId: 1, boardName: "Delivery", address: "board-1@intake.test" },
      ],
    });
    render(<EmailIntakePanel workspace={workspace()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Copy" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("board-1@intake.test"));
    expect(await screen.findByRole("button", { name: "Copied" })).toBeDefined();
  });
});

describe("SecurityPanel", () => {
  it("offers the allowlist form to an owner", async () => {
    render(<SecurityPanel workspace={workspace("owner")} />);
    await waitFor(() => expect(fetchIpAllowlist).toHaveBeenCalled());
    expect(screen.getByLabelText("CIDR range")).toBeDefined();
  });

  it("shows an admin the ranges but not the form", async () => {
    fetchIpAllowlist.mockResolvedValue([
      { id: 1, cidr: "203.0.113.0/24", label: "Office", createdAt: "2026-07-20T00:00:00.000Z" },
    ]);
    render(<SecurityPanel workspace={workspace("admin")} />);
    // Reading the ranges is how an admin diagnoses a locked-out colleague;
    // widening them is the owner's call.
    expect(await screen.findByText("203.0.113.0/24")).toBeDefined();
    expect(screen.queryByLabelText("CIDR range")).toBeNull();
    expect(screen.getByText(/Only workspace owners can change this policy/)).toBeDefined();
  });

  it("adds a range and clears the form", async () => {
    addIpAllowlistEntry.mockResolvedValue({});
    render(<SecurityPanel workspace={workspace("owner")} />);
    await waitFor(() => expect(fetchIpAllowlist).toHaveBeenCalledTimes(1));

    const cidr = screen.getByLabelText("CIDR range") as HTMLInputElement;
    fireEvent.change(cidr, { target: { value: "198.51.100.0/24" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() =>
      expect(addIpAllowlistEntry).toHaveBeenCalledWith("ws-1", "198.51.100.0/24", "")
    );
    await waitFor(() => expect(cidr.value).toBe(""));
  });

  it("surfaces a rejected CIDR instead of silently keeping it", async () => {
    addIpAllowlistEntry.mockRejectedValue(
      new Error("Enter a valid IPv4 CIDR, such as 203.0.113.0/24.")
    );
    render(<SecurityPanel workspace={workspace("owner")} />);
    await waitFor(() => expect(fetchIpAllowlist).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText("CIDR range"), {
      target: { value: "nonsense" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Enter a valid IPv4 CIDR"
    );
  });

  it("removes a range by its id", async () => {
    fetchIpAllowlist.mockResolvedValue([
      { id: 9, cidr: "203.0.113.0/24", label: "Office", createdAt: "2026-07-20T00:00:00.000Z" },
    ]);
    deleteIpAllowlistEntry.mockResolvedValue(undefined);
    render(<SecurityPanel workspace={workspace("owner")} />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Remove 203.0.113.0/24" })
    );
    await waitFor(() =>
      expect(deleteIpAllowlistEntry).toHaveBeenCalledWith("ws-1", 9)
    );
  });
});
