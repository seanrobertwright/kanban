// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "./dropdown-menu";
import { Button } from "./button";

/**
 * The menu primitive, guarding the failure that reached production twice.
 *
 * Base UI's `Menu.GroupLabel` throws when it has no `Menu.Group` ancestor, and
 * because that throw lands in render, React unmounts the tree — the page dies
 * rather than the menu. `tsc` and `next build` cannot see a context
 * requirement, so the only thing that catches it is opening the menu, which is
 * what these tests do.
 */

function Menu({ grouped }: { grouped: boolean }) {
  const label = <DropdownMenuLabel>Measure</DropdownMenuLabel>;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button>Board tools</Button>} />
      <DropdownMenuContent>
        {grouped ? (
          <DropdownMenuGroup>
            {label}
            <DropdownMenuItem>Insights</DropdownMenuItem>
          </DropdownMenuGroup>
        ) : (
          <>
            {label}
            <DropdownMenuItem>Insights</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

async function open() {
  const trigger = screen.getByRole("button", { name: "Board tools" });
  await act(async () => {
    fireEvent.pointerDown(trigger);
    fireEvent.pointerUp(trigger);
    fireEvent.click(trigger);
  });
}

describe("DropdownMenuLabel", () => {
  // The arrangement that took the board down: a label as a bare sibling.
  it("renders outside a group without throwing", async () => {
    render(<Menu grouped={false} />);
    await open();

    expect(screen.getByText("Measure")).toBeDefined();
    expect(screen.getByRole("menuitem", { name: "Insights" })).toBeDefined();
  });

  it("still renders inside a group, which is the preferred arrangement", async () => {
    render(<Menu grouped />);
    await open();

    expect(screen.getByText("Measure")).toBeDefined();
    expect(screen.getByRole("menuitem", { name: "Insights" })).toBeDefined();
  });

  /**
   * The fallback must not fire when an author did wrap the label: a group it
   * supplied for itself would hold the label and none of the items, which is
   * the wrong thing for `aria-labelledby` even though nothing crashes.
   */
  it("supplies a group only when one is missing", async () => {
    const { container, unmount } = render(<Menu grouped />);
    await open();
    expect(container.ownerDocument.querySelectorAll(
      '[data-slot="dropdown-menu-label-group"]'
    )).toHaveLength(0);
    unmount();

    render(<Menu grouped={false} />);
    await open();
    expect(document.querySelectorAll(
      '[data-slot="dropdown-menu-label-group"]'
    )).toHaveLength(1);
  });
});
