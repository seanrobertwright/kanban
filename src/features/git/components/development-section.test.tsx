// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DevelopmentSection } from "./development-section";
import type { TaskCiStatus, TaskGitLink } from "../types";

vi.mock("../client/api", () => ({
  fetchTaskGitLinks: vi.fn(),
  fetchTaskCiStatuses: vi.fn(),
}));
const { fetchTaskGitLinks, fetchTaskCiStatuses } = await import("../client/api");
const mockFetch = vi.mocked(fetchTaskGitLinks);
const mockCi = vi.mocked(fetchTaskCiStatuses);

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

function ciRun(over: Partial<TaskCiStatus>): TaskCiStatus {
  return {
    id: 1,
    taskId: 5,
    connectionId: 1,
    provider: "github",
    externalId: "900",
    ref: "feature/5-x",
    status: "completed",
    conclusion: "failure",
    url: "https://github.com/o/r/commit/abc/checks",
    title: "GitHub Actions",
    updatedAt: "2026-07-22T00:00:00Z",
    ...over,
  };
}

describe("DevelopmentSection", () => {
  it("renders a PR by title with its state chip and a link out", async () => {
    mockFetch.mockResolvedValue([link({})]);
    mockCi.mockResolvedValue([]);
    render(<DevelopmentSection taskId={5} />);

    const anchor = await screen.findByRole("link", { name: "Fix the login bug" });
    expect(anchor.getAttribute("href")).toBe("https://github.com/o/r/pull/42");
    expect(screen.getByText("merged")).toBeTruthy();
  });

  it("falls back to a short sha for a titleless commit", async () => {
    mockFetch.mockResolvedValue([
      link({ id: 2, kind: "commit", externalId: "abcdef1234567", title: null, state: null }),
    ]);
    mockCi.mockResolvedValue([]);
    render(<DevelopmentSection taskId={5} />);
    expect(await screen.findByText("abcdef1")).toBeTruthy();
  });

  it("renders a CI run with a failed chip (2.7)", async () => {
    mockFetch.mockResolvedValue([]);
    mockCi.mockResolvedValue([ciRun({})]);
    render(<DevelopmentSection taskId={5} />);
    const anchor = await screen.findByRole("link", { name: "GitHub Actions" });
    expect(anchor.getAttribute("href")).toBe("https://github.com/o/r/commit/abc/checks");
    expect(screen.getByText("failed")).toBeTruthy();
  });

  it("shows a running chip for an in-progress run", async () => {
    mockFetch.mockResolvedValue([]);
    mockCi.mockResolvedValue([ciRun({ status: "in_progress", conclusion: null })]);
    render(<DevelopmentSection taskId={5} />);
    expect(await screen.findByText("running")).toBeTruthy();
  });

  it("renders nothing when a task has no links and no CI", async () => {
    mockFetch.mockResolvedValue([]);
    mockCi.mockResolvedValue([]);
    const { container } = render(<DevelopmentSection taskId={5} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await waitFor(() => expect(mockCi).toHaveBeenCalled());
    expect(container.textContent).toBe("");
  });
});
