import { describe, expect, it } from "vitest";

import { LABEL_EDGE_ALLOWANCE, tickLabelTransform } from "./axis-ticks";

/**
 * The rule the Timeline and the Gantt share for placing a date label against
 * its tick (UI-1). Pure arithmetic on a fraction of the track — no DOM, because
 * the bug is a transform choice, not a layout one.
 */

describe("tickLabelTransform", () => {
  it("centres a label anywhere it fits", () => {
    for (const f of [0.1, 0.25, 0.5, 0.636, 0.8]) {
      expect(tickLabelTransform(f)).toBe("translateX(-50%)");
    }
  });

  // The bug as observed: "Aug 5" rendered as "g 5" because the first tick sits
  // on the track's left edge and a centred label puts half of itself outside,
  // where the view's overflow-x-auto clips it.
  it("left-aligns the label on the very first tick", () => {
    expect(tickLabelTransform(0)).toBe("translateX(0)");
  });

  // The same clip, mirrored: a Gantt window long enough for a weekly tick to
  // land near the far end would lose the right half of that label.
  it("right-aligns a label close enough to the end to overhang it", () => {
    expect(tickLabelTransform(1)).toBe("translateX(-100%)");
    expect(tickLabelTransform(1 - LABEL_EDGE_ALLOWANCE / 2)).toBe(
      "translateX(-100%)"
    );
  });

  // The boundary is a real one, not a rounding artifact: just inside the
  // allowance the label still fits centred and must stay centred, because a
  // shifted label no longer marks the date it names.
  it("keeps centring right up to the allowance", () => {
    expect(tickLabelTransform(1 - LABEL_EDGE_ALLOWANCE - 0.001)).toBe(
      "translateX(-50%)"
    );
  });

  // Nothing upstream should produce these, but a clamp that only works on
  // well-formed input is not a clamp.
  it("survives fractions outside the track", () => {
    expect(tickLabelTransform(-0.2)).toBe("translateX(0)");
    expect(tickLabelTransform(1.4)).toBe("translateX(-100%)");
    expect(tickLabelTransform(Number.NaN)).toBe("translateX(-50%)");
  });
});
