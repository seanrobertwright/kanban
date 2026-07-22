import { describe, expect, it } from "vitest";

import { suggestBranchName } from "./branch";
import { parseBranchRef } from "./parse";

describe("suggestBranchName", () => {
  it("builds feature/<id>-<slug> from a title", () => {
    expect(suggestBranchName(123, "Add OAuth login!")).toBe("feature/123-add-oauth-login");
  });

  it("falls back to feature/<id> when the title has no slug", () => {
    expect(suggestBranchName(7, "   ")).toBe("feature/7");
    expect(suggestBranchName(7, "***")).toBe("feature/7");
  });

  it("caps the slug and leaves no trailing dash", () => {
    const name = suggestBranchName(1, "a".repeat(60) + " tail");
    expect(name.length).toBeLessThanOrEqual("feature/1-".length + 40);
    expect(name.endsWith("-")).toBe(false);
  });

  it("round-trips: the ingress re-links the suggested branch to its task", () => {
    for (const [id, title] of [
      [123, "Add OAuth login"],
      [7, ""],
      [4210, "Fix: the thing / that broke"],
    ] as const) {
      expect(parseBranchRef(suggestBranchName(id, title))).toBe(id);
    }
  });
});
