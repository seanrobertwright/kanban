// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { Tags, Users } from "lucide-react";
import { describe, expect, it, vi } from "vitest";

import { SettingsDialog, openSettings, type SettingsSection } from "./settings-dialog";
import { Dialog, DialogContent, DialogTitle } from "@/shared/ui/dialog";

/** A panel written the way every feature panel is: as its own dialog. */
function Panel({ name }: { name: string }) {
  return (
    <Dialog open onOpenChange={() => {}}>
      <DialogContent>
        <DialogTitle>{name}</DialogTitle>
        <p>{name} body</p>
      </DialogContent>
    </Dialog>
  );
}

function Harness({ sections }: { sections: SettingsSection[] }) {
  const [section, setSection] = useState<string | null>(null);
  return (
    <SettingsDialog
      sections={sections}
      section={section}
      onSectionChange={setSection}
    />
  );
}

function sections(spies: Record<string, () => void> = {}): SettingsSection[] {
  return [
    {
      id: "members",
      label: "Members",
      group: "Workspace",
      icon: Users,
      description: "Who is in this workspace.",
      render: () => {
        spies.members?.();
        return <Panel name="Members" />;
      },
    },
    {
      id: "labels",
      label: "Labels",
      group: "Board",
      icon: Tags,
      render: () => {
        spies.labels?.();
        return <Panel name="Labels" />;
      },
    },
  ];
}

describe("SettingsDialog", () => {
  it("stays shut until something opens it", () => {
    render(<Harness sections={sections()} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens at the first section on a bare request", () => {
    render(<Harness sections={sections()} />);
    act(() => openSettings());
    expect(screen.getByText("Members body")).toBeDefined();
  });

  it("opens at a named section, which is how the palette reaches one directly", () => {
    render(<Harness sections={sections()} />);
    act(() => openSettings("labels"));
    expect(screen.getByText("Labels body")).toBeDefined();
  });

  it("falls back to the first section when asked for one that does not exist", () => {
    render(<Harness sections={sections()} />);
    act(() => openSettings("nonesuch"));
    expect(screen.getByText("Members body")).toBeDefined();
  });

  it("renders only the showing section — fifteen panels would be fifteen fetches", () => {
    const spies = { members: vi.fn(), labels: vi.fn() };
    render(<Harness sections={sections(spies)} />);
    act(() => openSettings());
    expect(spies.members).toHaveBeenCalled();
    expect(spies.labels).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /Labels/ }));
    expect(spies.labels).toHaveBeenCalled();
  });

  it("hosts the panel inline, so a section is not a modal on a modal", () => {
    render(<Harness sections={sections()} />);
    act(() => openSettings());
    // One dialog on screen: the settings surface. The panel inside it is a
    // region, even though it is written as a dialog.
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "Members" })).toBeDefined();
  });

  it("groups the nav by what is being configured", () => {
    render(<Harness sections={sections()} />);
    act(() => openSettings());
    const nav = screen.getByRole("navigation", { name: "Settings sections" });
    expect(nav.textContent).toContain("Workspace");
    expect(nav.textContent).toContain("Board");
  });

  it("marks the showing section, so the nav never lies about where you are", () => {
    render(<Harness sections={sections()} />);
    act(() => openSettings("labels"));
    expect(
      screen.getByRole("button", { name: /Labels/ }).getAttribute("aria-current")
    ).toBe("page");
    expect(
      screen.getByRole("button", { name: /Members/ }).getAttribute("aria-current")
    ).toBeNull();
  });
});
