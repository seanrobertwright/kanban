// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "./theme-provider";

describe("ThemeProvider", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({
        matches: false,
        addListener: vi.fn(),
        removeListener: vi.fn(),
      }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("marks the client-rendered initialization script as inert", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const { container } = render(
      <ThemeProvider>
        <div>Content</div>
      </ThemeProvider>,
    );

    expect(container.querySelector("script")?.getAttribute("type")).toBe(
      "text/plain",
    );
    expect(consoleError).not.toHaveBeenCalledWith(
      expect.stringContaining("Encountered a script tag"),
    );
  });
});
