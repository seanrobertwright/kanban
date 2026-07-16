// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ActivityFeed } from "./activity-feed";
import type {
  ActivityEntry,
  CommentAction,
  CommentSnapshot,
  TaskAction,
  TaskSnapshot,
} from "../types";

vi.mock("../client/api", () => ({ fetchTaskActivity: vi.fn() }));
const { fetchTaskActivity } = await import("../client/api");

const COLUMN_NAMES = { 1: "To Do", 3: "Done" };
const MEMBER_NAMES = { "user-1": "Alice", "user-2": "Bob" };

/**
 * One builder per arm of the union, rather than one taking
 * `Partial<ActivityEntry>`.
 *
 * The latter stopped compiling at 005 and that is the type working: a partial of
 * a union is satisfied by mixing the arms, so it would happily build a
 * task.moved carrying a CommentSnapshot — a row the app can no longer write, and
 * so a row the tests should not be able to fake either. A test helper loose
 * enough to construct impossible data quietly tests a different program.
 */
type TaskEntry = Extract<ActivityEntry, { action: TaskAction }>;
type CommentEntry = Extract<ActivityEntry, { action: CommentAction }>;

function snapshot(over: Partial<TaskSnapshot> = {}): TaskSnapshot {
  return {
    title: "A task",
    description: "",
    columnId: 1,
    position: 0,
    assigneeId: null,
    ...over,
  };
}

function commentSnapshot(over: Partial<CommentSnapshot> = {}): CommentSnapshot {
  return {
    commentId: 5,
    body: "Looks good to me",
    author: { type: "human", id: "user-1" },
    ...over,
  };
}

function entry(over: Partial<TaskEntry> = {}): TaskEntry {
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

function commentEntry(over: Partial<CommentEntry> = {}): CommentEntry {
  return {
    id: "1",
    workspaceId: "ws-1",
    boardId: 1,
    taskId: 7,
    actorType: "human",
    actorId: "user-1",
    actorName: "Alice",
    actorImage: null,
    action: "comment.created",
    before: null,
    after: commentSnapshot(),
    createdAt: new Date().toISOString(),
    ...over,
  };
}

async function renderFeed(entries: ActivityEntry[]) {
  vi.mocked(fetchTaskActivity).mockResolvedValue(entries);
  render(
    <ActivityFeed
      taskId={7}
      columnNames={COLUMN_NAMES}
      memberNames={MEMBER_NAMES}
    />
  );
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
    await renderFeed([entry({ action: "task.archived" as TaskAction })]);
    expect(screen.getByText(/changed this/)).toBeDefined();
  });

  it("says so when a task has no history", async () => {
    vi.mocked(fetchTaskActivity).mockResolvedValue([]);
    render(
      <ActivityFeed
        taskId={7}
        columnNames={COLUMN_NAMES}
        memberNames={MEMBER_NAMES}
      />
    );
    expect(await screen.findByText("No history yet.")).toBeDefined();
  });

  describe("assignment", () => {
    it("names who a task was assigned to", async () => {
      await renderFeed([
        entry({
          action: "task.assigned",
          before: snapshot({ assigneeId: null }),
          after: snapshot({ assigneeId: "user-2" }),
        }),
      ]);
      expect(screen.getByText(/assigned this to Bob/)).toBeDefined();
    });

    it("names both sides of a reassignment", async () => {
      await renderFeed([
        entry({
          actorId: "user-9",
          action: "task.assigned",
          before: snapshot({ assigneeId: "user-1" }),
          after: snapshot({ assigneeId: "user-2" }),
        }),
      ]);
      expect(screen.getByText(/reassigned this from Alice to Bob/)).toBeDefined();
    });

    it("reports an unassignment as one, naming who lost it", async () => {
      await renderFeed([
        entry({
          action: "task.assigned",
          before: snapshot({ assigneeId: "user-2" }),
          after: snapshot({ assigneeId: null }),
        }),
      ]);
      expect(screen.getByText(/unassigned Bob/)).toBeDefined();
    });

    it("calls self-assignment taking it on", async () => {
      await renderFeed([
        entry({
          actorId: "user-2",
          actorName: "Bob",
          action: "task.assigned",
          before: snapshot({ assigneeId: null }),
          after: snapshot({ assigneeId: "user-2" }),
        }),
      ]);
      expect(screen.getByText(/took this on/)).toBeDefined();
    });

    it("survives an assignee who has left the workspace", async () => {
      // The routine case, not the edge one: removing a member clears their
      // assignments but not the log of them, so these ids stop resolving the
      // moment someone leaves.
      await renderFeed([
        entry({
          action: "task.assigned",
          before: snapshot({ assigneeId: "user-gone" }),
          after: snapshot({ assigneeId: null }),
        }),
      ]);
      expect(screen.getByText(/unassigned a former member/)).toBeDefined();
    });

    it("reads an entry written before assignees existed without inventing one", async () => {
      // Rows logged before 004 have no assigneeId key at all. undefined must
      // read as "nobody", never as a name.
      const legacy = snapshot();
      delete legacy.assigneeId;
      await renderFeed([
        entry({
          action: "task.assigned",
          before: legacy,
          after: snapshot({ assigneeId: "user-2" }),
        }),
      ]);
      expect(screen.getByText(/assigned this to Bob/)).toBeDefined();
    });
  });

  describe("comments", () => {
    it("reports a comment without repeating its text", async () => {
      // The thread renders the body a few inches away. Repeating it here would
      // be a second copy of the same string, free to drift from the first once
      // the comment is edited.
      await renderFeed([commentEntry()]);
      expect(screen.getByText(/commented/)).toBeDefined();
      expect(screen.queryByText(/Looks good to me/)).toBeNull();
    });

    it("reports an edit as an edit", async () => {
      await renderFeed([
        commentEntry({
          action: "comment.updated",
          before: commentSnapshot({ body: "Old" }),
          after: commentSnapshot({ body: "New" }),
        }),
      ]);
      expect(screen.getByText(/edited a comment/)).toBeDefined();
    });

    it("names whose comment an admin deleted", async () => {
      // The one entry where actor and subject routinely differ, and the reason
      // CommentSnapshot carries the author at all.
      await renderFeed([
        commentEntry({
          action: "comment.deleted",
          actorId: "user-1",
          actorName: "Alice",
          before: commentSnapshot({ author: { type: "human", id: "user-2" } }),
          after: null,
        }),
      ]);
      expect(screen.getByText(/deleted Bob's comment/)).toBeDefined();
    });

    it("distinguishes deleting your own comment", async () => {
      await renderFeed([
        commentEntry({
          action: "comment.deleted",
          actorId: "user-2",
          actorName: "Bob",
          before: commentSnapshot({ author: { type: "human", id: "user-2" } }),
          after: null,
        }),
      ]);
      expect(screen.getByText(/deleted their comment/)).toBeDefined();
    });

    it("calls an agent's deleted comment an agent's", async () => {
      // An agent id will not resolve against the member list, so without the
      // author's type this would read "deleted a former member's comment".
      await renderFeed([
        commentEntry({
          action: "comment.deleted",
          before: commentSnapshot({ author: { type: "agent", id: "agent-1" } }),
          after: null,
        }),
      ]);
      expect(screen.getByText(/deleted an agent's comment/)).toBeDefined();
    });
  });
});
