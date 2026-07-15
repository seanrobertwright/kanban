// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ActivityFeed } from "./activity-feed";
import type { ActivityEntry, TaskSnapshot } from "../types";

vi.mock("../client/api", () => ({ fetchTaskActivity: vi.fn() }));
const { fetchTaskActivity } = await import("../client/api");

const COLUMN_NAMES = { 1: "To Do", 3: "Done" };

function snapshot(over: Partial<TaskSnapshot> = {}): TaskSnapshot {
  return { title: "A task", description: "", columnId: 1, position: 0, ...over };
}

function entry(over: Partial<ActivityEntry> = {}): ActivityEntry {
  return {
    id: "1",
    workspaceId: "ws-1",
    boardId: 1,
    taskId: 7,
    actorType: "human",
    actorId: "user-1",
    actorName: "Alice",
    actorImage: null,
    action: "task.created",
    before: null,
    after: snapshot(),
    createdAt: new Date().toISOString(),
    ...over,
  };
}

async function renderFeed(entries: ActivityEntry[]) {
  vi.mocked(fetchTaskActivity).mockResolvedValue(entries);
  render(<ActivityFeed taskId={7} columnNames={COLUMN_NAMES} />);
  // The feed fetches on mount, so every assertion waits for the first paint.
  return screen.findByRole("list");
}

/**
 * The prose these render is not type-checked and is the whole point of the
 * feature — an entry that says the wrong thing is worse than no entry, since
 * the audit trail's only job is to be believed.
 */
describe("ActivityFeed", () => {
  beforeEach(() => vi.clearAllMocks());

  it("names the columns a task moved between", async () => {
    await renderFeed([
      entry({
        action: "task.moved",
        before: snapshot({ columnId: 1 }),
        after: snapshot({ columnId: 3 }),
      }),
    ]);
    expect(screen.getByText(/moved this to Done/)).toBeDefined();
  });

  it("calls a same-column move a reorder, not a move", async () => {
    await renderFeed([
      entry({
        action: "task.moved",
        before: snapshot({ columnId: 1, position: 0 }),
        after: snapshot({ columnId: 1, position: 2 }),
      }),
    ]);
    expect(screen.getByText(/reordered this within To Do/)).toBeDefined();
  });

  it("survives a column that has since been deleted", async () => {
    // The log outlives the board_column row it names, so the id may resolve to
    // nothing. It must read as prose, not "moved this to undefined".
    await renderFeed([
      entry({
        action: "task.moved",
        before: snapshot({ columnId: 1 }),
        after: snapshot({ columnId: 99 }),
      }),
    ]);
    expect(screen.getByText(/moved this to another column/)).toBeDefined();
  });

  it("distinguishes a rename from a description edit", async () => {
    await renderFeed([
      entry({
        id: "2",
        action: "task.updated",
        before: snapshot({ title: "Old" }),
        after: snapshot({ title: "New" }),
      }),
    ]);
    expect(screen.getByText(/renamed this to "New"/)).toBeDefined();
  });

  it("reports a description-only edit as such", async () => {
    await renderFeed([
      entry({
        action: "task.updated",
        before: snapshot({ description: "" }),
        after: snapshot({ description: "details" }),
      }),
    ]);
    expect(screen.getByText(/edited the description/)).toBeDefined();
  });

  it("keeps an entry whose author has been deleted", async () => {
    // actor_id has no FK precisely so this row survives; dropping it from the
    // UI would undo that at the last step.
    await renderFeed([entry({ actorName: null })]);
    expect(screen.getByText("A removed user")).toBeDefined();
    expect(screen.getByText(/created this task/)).toBeDefined();
  });

  it("labels an agent actor as one", async () => {
    await renderFeed([entry({ actorType: "agent", actorName: null })]);
    expect(screen.getByText("An agent")).toBeDefined();
  });

  it("renders an unknown future action without crashing", async () => {
    // `action` is TEXT and the union grows every milestone, so a row written by
    // newer code can reach this component.
    await renderFeed([
      entry({ action: "task.archived" as ActivityEntry["action"] }),
    ]);
    expect(screen.getByText(/changed this task/)).toBeDefined();
  });

  it("says so when a task has no history", async () => {
    vi.mocked(fetchTaskActivity).mockResolvedValue([]);
    render(<ActivityFeed taskId={7} columnNames={COLUMN_NAMES} />);
    expect(await screen.findByText("No history yet.")).toBeDefined();
  });
});
