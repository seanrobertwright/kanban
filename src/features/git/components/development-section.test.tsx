// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DevelopmentSection } from "./development-section";
import type { TaskGitLink } from "../types";

vi.mock("../client/api", () => ({ fetchTaskGitLinks: vi.fn() }));
const { fetchTaskGitLinks } = await import("../client/api");
const mockFetch = vi.mocked(fetchTaskGitLinks);

function link(over: Partial<TaskGitLink>): TaskGitLink {
  return {
    id: 1,
    taskId: 5,
    connectionId: 1,
    provider: "github",
    kind: "pr",
    externalId: "42",
    url: "https://github.com/o/r/pull/42",
    state: "merged",
    title: "Fix the login bug",
    updatedAt: "2026-07-22T00:00:00Z",
    ...over,
  };
}

describe("DevelopmentSection", () => {
  it("renders a PR by title with its state chip and a link out", async () => {
    mockFetch.mockResolvedValue([link({})]);
    render(<DevelopmentSection taskId={5} />);

    const anchor = await screen.findByRole("link", { name: "Fix the login bug" });
    expect(anchor.getAttribute("href")).toBe("https://github.com/o/r/pull/42");
    expect(screen.getByText("merged")).toBeTruthy();
  });

  it("falls back to a short sha for a titleless commit", async () => {
    mockFetch.mockResolvedValue([
      link({ id: 2, kind: "commit", externalId: "abcdef1234567", title: null, state: null }),
    ]);
    render(<DevelopmentSection taskId={5} />);
    expect(await screen.findByText("abcdef1")).toBeTruthy();
  });

  it("renders nothing when a task has no links", async () => {
    mockFetch.mockResolvedValue([]);
    const { container } = render(<DevelopmentSection taskId={5} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(container.textContent).toBe("");
  });
});
