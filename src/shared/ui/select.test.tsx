// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useState } from "react";

import { Label } from "./label";
import { Select, SelectGroup, SelectItem } from "./select";

/**
 * The wrapper replaced a native <select>, so these pin the parts of that
 * contract the call sites still rely on: the label points at the control, the
 * trigger shows the selected item's *label* rather than its value, and picking
 * reports the value string.
 */
function Fixture({ onChange }: { onChange?: (v: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <>
      <Label htmlFor="fruit">Fruit</Label>
      <Select
        id="fruit"
        value={value}
        onValueChange={(v) => {
          setValue(v);
          onChange?.(v);
        }}
      >
        <SelectItem value="">None</SelectItem>
        <SelectGroup label="Citrus">
          <SelectItem value="orange">Orange</SelectItem>
        </SelectGroup>
        <SelectItem value="apple">Apple</SelectItem>
      </Select>
    </>
  );
}

/** Base UI opens the popup on the trigger's click. */
async function open() {
  fireEvent.click(screen.getByLabelText("Fruit"));
  await waitFor(() => expect(screen.getAllByRole("option").length).toBe(3));
}

/**
 * Base UI ignores a bare `click` on an item: it only honours a mouse click that
 * began on that item, which it learns from the preceding pointerdown. A lone
 * `fireEvent.click` looks like a virtual click on an unhighlighted item and is
 * discarded, so the pointerdown is required, not decoration.
 */
function choose(name: string) {
  const option = screen.getByRole("option", { name });
  fireEvent.pointerDown(option, { pointerType: "mouse" });
  fireEvent.click(option, { detail: 1 });
}

describe("Select", () => {
  it("labels the trigger, so getByLabelText still finds the control", () => {
    render(<Fixture />);
    expect(screen.getByLabelText("Fruit").getAttribute("role")).toBe(
      "combobox"
    );
  });

  it("offers every item, flattening groups like optgroups did", async () => {
    render(<Fixture />);
    await open();
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "None",
      "Orange",
      "Apple",
    ]);
  });

  it("reports the chosen item's value, not its label", async () => {
    const onChange = vi.fn();
    render(<Fixture onChange={onChange} />);
    await open();
    choose("Orange");
    await waitFor(() => expect(onChange).toHaveBeenCalledWith("orange"));
  });

  it("shows the selected item's label in the trigger", async () => {
    render(<Fixture />);
    await open();
    choose("Apple");
    // The regression this guards: without Root's `items`, Base UI renders the
    // raw value here, so the trigger would read "apple".
    await waitFor(() =>
      expect(screen.getByLabelText("Fruit").textContent).toContain("Apple")
    );
  });
});
