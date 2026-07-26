// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  InlineDialogHost,
} from "./dialog";

/**
 * A stand-in for the fifteen feature panels the Settings surface hosts: each is
 * written as its own dialog and has to work unchanged in both places.
 */
function Panel({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="fixed top-1/2 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Labels</DialogTitle>
          <DialogDescription>The workspace vocabulary.</DialogDescription>
        </DialogHeader>
        <p>panel body</p>
        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  );
}

describe("Dialog inline mode", () => {
  it("renders an unchanged panel as a region rather than a modal", () => {
    render(
      <InlineDialogHost>
        <Panel open onOpenChange={() => {}} />
      </InlineDialogHost>
    );
    // The content is there…
    expect(screen.getByText("panel body")).toBeDefined();
    expect(screen.getByText("The workspace vocabulary.")).toBeDefined();
    // …but not as a dialog: no role, and no backdrop over the surface behind.
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.querySelector('[data-slot="dialog-overlay"]')).toBeNull();
  });

  it("gives the title a real heading, so the section joins the page outline", () => {
    render(
      <InlineDialogHost>
        <Panel open onOpenChange={() => {}} />
      </InlineDialogHost>
    );
    expect(screen.getByRole("heading", { name: "Labels" }).tagName).toBe("H2");
  });

  it("drops the popup's positioning, which would anchor a region to the viewport", () => {
    render(
      <InlineDialogHost>
        <Panel open onOpenChange={() => {}} />
      </InlineDialogHost>
    );
    const content = document.querySelector('[data-slot="dialog-content"]')!;
    expect(content.className).not.toContain("fixed");
    expect(content.className).not.toContain("sm:max-w-2xl");
  });

  it("still honours open={false} — a panel saying 'not now' is not a modal question", () => {
    render(
      <InlineDialogHost>
        <Panel open={false} onOpenChange={() => {}} />
      </InlineDialogHost>
    );
    expect(screen.queryByText("panel body")).toBeNull();
  });

  it("wires Close to the panel's own handler, there being no Root to ask", () => {
    const onOpenChange = vi.fn();
    render(
      <InlineDialogHost>
        <Panel open onOpenChange={onOpenChange} />
      </InlineDialogHost>
    );
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onOpenChange).toHaveBeenCalledWith(false, undefined);
  });

  it("clears the flag beneath it, so a panel's own confirm is still a modal", () => {
    render(
      <InlineDialogHost>
        <Dialog open onOpenChange={() => {}}>
          <DialogContent>
            <DialogTitle>Outer</DialogTitle>
            {/* What a panel opening a destructive confirm looks like. */}
            <Dialog open onOpenChange={() => {}}>
              <DialogContent>
                <DialogTitle>Really delete?</DialogTitle>
              </DialogContent>
            </Dialog>
          </DialogContent>
        </Dialog>
      </InlineDialogHost>
    );
    // Exactly one of the two went inline; the nested one is a real dialog.
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByRole("dialog").textContent).toContain("Really delete?");
  });

  it("is inert outside a host — the same panel is a modal on its own", () => {
    render(<Panel open onOpenChange={() => {}} />);
    expect(screen.getByRole("dialog")).toBeDefined();
  });
});
