import { describe, expect, it } from "vitest";
import { readManifest } from "./types";

describe("readManifest", () => {
  const valid = {
    name: "example.badge",
    url: "https://extensions.example.test/badge",
    capabilities: ["task.read"],
    slots: ["card_badge"],
  };

  it("accepts a constrained HTTPS manifest and de-duplicates declarations", () => {
    expect(readManifest({ ...valid, capabilities: ["task.read", "task.read"], slots: ["card_badge", "card_badge"] })).toEqual(valid);
  });

  it("rejects non-HTTPS URLs, unknown capabilities, and unknown slots", () => {
    expect(readManifest({ ...valid, url: "http://extensions.example.test" })).toBeNull();
    expect(readManifest({ ...valid, capabilities: ["task.write"] })).toBeNull();
    expect(readManifest({ ...valid, slots: ["arbitrary_script"] })).toBeNull();
  });
});
