// @vitest-environment jsdom
import { DndContext } from "@dnd-kit/core";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { BoardColumn } from "./board-column";
import type { Column } from "../types";

const column: Column = { id: 1, boardId: 1, title: "To Do", position: 0 };

function renderColumn(
  over: Partial<React.ComponentProps<typeof BoardColumn>> = {}
) {
  const props = {
    column,
    tasks: [],
    membersById: {},
    labelsById: {},
    canEdit: true,
    canDelete: true,
    isFirst: false,
    isLast: false,
    onAddTask: vi.fn(),
    onEditTask: vi.fn(),
    onDeleteTask: vi.fn(),
    onRename: vi.fn(),
    onMove: vi.fn(),
    onDelete: vi.fn(),
    ...over,
  };
  // useDroppable and SortableContext both need a DndContext above them.
  render(
    <DndContext>
      <BoardColumn {...props} />
    </DndContext>
  );
  return props;
}

/**
 * Base UI does not render popup children while closed, so the menu has to be
 * opened for real — the same reason board-switcher.test.tsx does this.
 */
async function openMenu() {
  const trigger = screen.getByRole("button", {
    name: /Column options for To Do/,
  });
  await act(async () => {
    fireEvent.pointerDown(trigger);
    fireEvent.pointerUp(trigger);
    fireEvent.click(trigger);
  });
}

describe("BoardColumn", () => {
  it("renders the title", () => {
    renderColumn();
    expect(screen.getByRole("heading", { name: "To Do" })).toBeDefined();
  });

  it("offers a viewer no column menu at all", () => {
    // The server refuses these regardless; this only keeps the UI honest about
    // what is on offer.
    renderColumn({ canEdit: false });
    expect(
      screen.queryByRole("button", { name: /Column options/ })
    ).toBeNull();
  });

  describe("renaming", () => {
    it("opens the rename box holding the current title", async () => {
      renderColumn();
      await openMenu();
      await act(async () => {
        fireEvent.click(screen.getByRole("menuitem", { name: /Rename/ }));
      });
      const input = screen.getByLabelText("Column title");
      // A rename is a revision, not a retype.
      expect((input as HTMLInputElement).value).toBe("To Do");
    });

    it("renames on Enter", async () => {
      const props = renderColumn();
      await openMenu();
      await act(async () => {
        fireEvent.click(screen.getByRole("menuitem", { name: /Rename/ }));
      });

      const input = screen.getByLabelText("Column title");
      fireEvent.change(input, { target: { value: "Doing" } });
      fireEvent.keyDown(input, { key: "Enter" });

      expect(props.onRename).toHaveBeenCalledWith("Doing");
    });

    it("abandons the rename on Escape", async () => {
      const props = renderColumn();
      await openMenu();
      await act(async () => {
        fireEvent.click(screen.getByRole("menuitem", { name: /Rename/ }));
      });

      const input = screen.getByLabelText("Column title");
      fireEvent.change(input, { target: { value: "Never mind" } });
      fireEvent.keyDown(input, { key: "Escape" });

      expect(props.onRename).not.toHaveBeenCalled();
      expect(screen.getByRole("heading", { name: "To Do" })).toBeDefined();
    });

    it("treats an emptied title as a slip, not an intent", async () => {
      const props = renderColumn();
      await openMenu();
      await act(async () => {
        fireEvent.click(screen.getByRole("menuitem", { name: /Rename/ }));
      });

      const input = screen.getByLabelText("Column title");
      fireEvent.change(input, { target: { value: "   " } });
      fireEvent.keyDown(input, { key: "Enter" });

      expect(props.onRename).not.toHaveBeenCalled();
      expect(screen.getByRole("heading", { name: "To Do" })).toBeDefined();
    });

    it("sends nothing when the title did not change", async () => {
      // No-ops are not mutations — the same rule the repository follows, applied
      // one layer up so the request is never made at all.
      const props = renderColumn();
      await openMenu();
      await act(async () => {
        fireEvent.click(screen.getByRole("menuitem", { name: /Rename/ }));
      });
      fireEvent.keyDown(screen.getByLabelText("Column title"), { key: "Enter" });
      expect(props.onRename).not.toHaveBeenCalled();
    });
  });

  describe("reordering", () => {
    it("moves left and right", async () => {
      const props = renderColumn();
      await openMenu();
      await act(async () => {
        fireEvent.click(screen.getByRole("menuitem", { name: /Move left/ }));
      });
      expect(props.onMove).toHaveBeenCalledWith(-1);
    });

    // Base UI marks a disabled item with data-disabled and leaves the attribute
    // off entirely otherwise — so each of these asserts the other item is
    // enabled too. Without that contrast, an attribute that was always present
    // would pass just as happily and prove nothing.
    it("cannot move the first column left", async () => {
      renderColumn({ isFirst: true });
      await openMenu();
      expect(
        screen.getByRole("menuitem", { name: /Move left/ }).getAttribute("data-disabled")
      ).not.toBeNull();
      expect(
        screen.getByRole("menuitem", { name: /Move right/ }).getAttribute("data-disabled")
      ).toBeNull();
    });

    it("cannot move the last column right", async () => {
      renderColumn({ isLast: true });
      await openMenu();
      expect(
        screen.getByRole("menuitem", { name: /Move right/ }).getAttribute("data-disabled")
      ).not.toBeNull();
      expect(
        screen.getByRole("menuitem", { name: /Move left/ }).getAttribute("data-disabled")
      ).toBeNull();
    });
  });

  describe("deleting", () => {
    it("offers delete to an admin", async () => {
      const props = renderColumn({ canDelete: true });
      await openMenu();
      await act(async () => {
        fireEvent.click(screen.getByRole("menuitem", { name: /Delete column/ }));
      });
      expect(props.onDelete).toHaveBeenCalled();
    });

    it("offers a plain member everything except delete", async () => {
      // Blast radius: a member may rename and reorder, but deleting can destroy
      // work and takes admin.
      renderColumn({ canEdit: true, canDelete: false });
      await openMenu();
      expect(screen.getByRole("menuitem", { name: /Rename/ })).toBeDefined();
      expect(screen.queryByRole("menuitem", { name: /Delete column/ })).toBeNull();
    });
  });
});
