import { describe, expect, it } from "vitest";

import { compileReleaseNotes } from "./notes";

describe("compileReleaseNotes", () => {
  it("compiles trimmed, non-empty titles into a Markdown bullet list", () => {
    expect(compileReleaseNotes(["  Add OAuth ", "Fix login", "  "])).toBe(
      "- Add OAuth\n- Fix login"
    );
  });

  it("returns null when there is nothing to list", () => {
    expect(compileReleaseNotes([])).toBeNull();
    expect(compileReleaseNotes(["   ", ""])).toBeNull();
  });
});
