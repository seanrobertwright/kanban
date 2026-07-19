// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { AgentSummary } from "@/features/agents/types";
import type { Member } from "@/features/workspaces/types";
import { TaskCard } from "./task-card";
import type { Task } from "../types";

const MEMBERS_BY_ID: Record<string, Member> = {
  "u-alice": {
    userId: "u-alice",
    name: "Alice",
    email: "alice@example.test",
    image: null,
    role: "member",
    createdAt: "2026-07-15T00:00:00.000Z",
  },
};

const AGENTS_BY_ID: Record<string, AgentSummary> = {
  "a-triage": { id: "a-triage", name: "Triage Bot", image: null, role: "member" },
};

function task(over: Partial<Task> = {}): Task {
  return {
    id: 7,
    columnId: 1,
    title: "A task",
    description: "",
    position: 0,
    assignee: null,
    priority: "none",
    dueDate: null,
    labels: [],
    parentId: null,
    subtaskCount: 0,
    blockedByCount: 0,
    blockedByOpenCount: 0,
    type: "task",
    estimate: null,
    milestoneId: null,
    recurrence: null,
    attachmentCount: 0,
    checklist: { total: 0, done: 0 },
    claimedBy: null,
    claimedAt: null,
    createdAt: "2026-07-15T00:00:00.000Z",
    ...over,
  };
}

const card = (over: Partial<Task> = {}) => (
  <TaskCard
    task={task(over)}
    membersById={MEMBERS_BY_ID}
    agentsById={AGENTS_BY_ID}
  />
);

/** Comfortably in the past and the future, so neither depends on when this runs. */
const LONG_PAST = "2020-01-01";
const FAR_FUTURE = "2999-01-01";

describe("TaskCard priority", () => {
  it("says the priority in words, not only in colour", () => {
    // Roughly one reader in twenty cannot separate the amber dot from the red
    // one, and the dot is the entire signal. The label is the content.
    render(card({ priority: "urgent" }));
    expect(screen.getByRole("img", { name: "Priority: Urgent" })).toBeDefined();
  });

  it("renders nothing at all for an untriaged task", () => {
    // 'none' is the default state of most cards. A grey dot on every one of them
    // would cost the space and say nothing.
    render(card({ priority: "none" }));
    expect(screen.queryByRole("img", { name: /Priority/ })).toBeNull();
  });
});

describe("TaskCard assignee", () => {
  it("names a human assignee", () => {
    render(card({ assignee: { type: "human", id: "u-alice" } }));
    expect(screen.getByText("Assigned to Alice")).toBeDefined();
  });

  it("marks an agent assignee as an agent — the wedge on a card", () => {
    // A person and an agent both hold work; the bot mark and the word are what
    // say which, "counting human and agent capacity as peers" (§4.3).
    render(card({ assignee: { type: "agent", id: "a-triage" } }));
    expect(screen.getByText("Agent Triage Bot")).toBeDefined();
  });

  it("says nothing when the assignee id no longer resolves", () => {
    // Between a member's removal and the board's refetch the id stops resolving;
    // the card renders nothing rather than a broken face.
    render(card({ assignee: { type: "human", id: "u-gone" } }));
    expect(screen.queryByText(/Assigned to|Agent /)).toBeNull();
  });
});

describe("TaskCard claim", () => {
  it("shows an agent's hold in words, not only an icon", () => {
    // A claimed card is one an agent is actively working — the wedge on a card.
    // The lock is decorative; the sentence is the content, for a reader who
    // cannot see it.
    render(card({ claimedBy: { type: "agent", id: "a1" } }));
    expect(screen.getByText("An agent is working on this")).toBeDefined();
  });

  it("says nothing about a claim on a free task", () => {
    render(card({ claimedBy: null }));
    expect(screen.queryByText(/working on this/)).toBeNull();
  });
});

describe("TaskCard due date", () => {
  it("renders the date without a zone to be wrong about", () => {
    // Formatted from the string, never through a Date. In a UTC-anchored
    // rendering this would read 31 Dec 2025 anywhere east of Greenwich.
    render(card({ dueDate: "2026-01-01" }));
    expect(screen.getByText("1 Jan 2026")).toBeDefined();
  });

  it("marks a past date overdue, in words as well as colour", () => {
    render(card({ dueDate: LONG_PAST }));
    expect(screen.getByText(/Overdue:/)).toBeDefined();
  });

  it("leaves a future date alone", () => {
    render(card({ dueDate: FAR_FUTURE }));
    expect(screen.queryByText(/Overdue:/)).toBeNull();
  });

  /**
   * The reason useToday is a useSyncExternalStore with a getServerSnapshot
   * rather than a plain `new Date()`, proven rather than asserted.
   *
   * A due date is zoneless, so "overdue" needs the reader's zone — which the
   * server does not have. If the server answered in its own zone (UTC in the
   * container), a card rendered at 8pm in Denver would arrive from the server
   * claiming a task due today was overdue, and then contradict itself on
   * hydration. So the server must answer "I don't know", and the only way to see
   * that it does is to render it as the server does.
   */
  describe("server rendering", () => {
    it("claims nothing is overdue, because the server has no reader", () => {
      const html = renderToString(card({ dueDate: LONG_PAST }));
      expect(html).not.toContain("Overdue");
    });

    it("still renders the date itself", () => {
      // The date is a fact about the task and the server knows it. Only the
      // *judgement* about it needs a reader — losing both would be an
      // overcorrection, and would flash the date in on hydration.
      const html = renderToString(card({ dueDate: "2026-01-01" }));
      expect(html).toContain("1 Jan 2026");
    });

    it("renders a past and a future date identically, up to the date itself", () => {
      // The sharpest statement of the property: on the server, "overdue" is not
      // a distinction that exists. If any future change makes the server guess
      // at today, these two diverge and this fails.
      const past = renderToString(card({ dueDate: LONG_PAST }));
      const future = renderToString(card({ dueDate: FAR_FUTURE }));
      expect(past.replace(LONG_PAST, "D").replace("1 Jan 2020", "F")).toBe(
        future.replace(FAR_FUTURE, "D").replace("1 Jan 2999", "F")
      );
    });
  });
});

describe("TaskCard subtask count", () => {
  it("shows the count when a task has pieces", () => {
    // The one fact the card carries about a task's pieces — the pieces
    // themselves are a dialog's fetch away (008). A number, not "2 of 5 done":
    // completion is a second query and depends on which columns are "done",
    // which is user-defined and unknowable from a card.
    render(card({ subtaskCount: 3 }));
    expect(screen.getByText("3")).toBeDefined();
    // Stated in words for a screen reader, not left to the icon alone.
    expect(screen.getByTitle("3 subtasks")).toBeDefined();
  });

  it("says subtask, singular, when there is one", () => {
    render(card({ subtaskCount: 1 }));
    expect(screen.getByTitle("1 subtask")).toBeDefined();
  });

  it("shows nothing when a task has no pieces", () => {
    // Most tasks have none, and a "0" on every card is noise that costs the
    // space to say nothing — the same call the priority dot makes for 'none'.
    render(card({ subtaskCount: 0 }));
    expect(screen.queryByText("0")).toBeNull();
  });
});

describe("TaskCard dependency state", () => {
  it("reads as blocked, with the open count, when blockers are unfinished", () => {
    // blockedByOpenCount > 0 is the real "blocked" (020's done column made it
    // knowable): the task waits on unfinished work, so the badge shows how many
    // are still open and says so for a screen reader.
    render(card({ blockedByCount: 3, blockedByOpenCount: 2 }));
    expect(screen.getByTitle("Blocked by 2 unfinished tasks")).toBeDefined();
    expect(screen.getByText("2")).toBeDefined();
  });

  it("says one unfinished task, singular", () => {
    render(card({ blockedByCount: 1, blockedByOpenCount: 1 }));
    expect(screen.getByTitle("Blocked by 1 unfinished task")).toBeDefined();
  });

  it("reads as a neutral dependency when every blocker is done", () => {
    // Has blockers, none open — all finished, or no done column to judge by. Not
    // blocked, so the neutral "depends on N" rather than the destructive state.
    render(card({ blockedByCount: 2, blockedByOpenCount: 0 }));
    expect(screen.getByTitle("Depends on 2 tasks")).toBeDefined();
    expect(screen.queryByTitle(/unfinished/)).toBeNull();
  });

  it("shows no dependency badge when a task depends on nothing", () => {
    render(card({ blockedByCount: 0, blockedByOpenCount: 0 }));
    expect(screen.queryByTitle(/Depends on|Blocked by/)).toBeNull();
  });
});
