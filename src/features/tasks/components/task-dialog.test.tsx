// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { AgentSummary } from "@/features/agents/types";
import type { Label as LabelData } from "@/features/labels/types";
import type { Member } from "@/features/workspaces/types";
import { TaskDialog } from "./task-dialog";
import type { Task } from "../types";

// The dialog mounts these for an existing task, and each would otherwise fetch.
// They are covered by their own suites.
vi.mock("@/features/activity/components/activity-feed", () => ({
  ActivityFeed: () => null,
}));
vi.mock("@/features/comments/components/comment-thread", () => ({
  CommentThread: () => null,
}));
vi.mock("./subtask-list", () => ({
  SubtaskList: () => null,
}));
vi.mock("@/features/dependencies/components/dependency-section", () => ({
  DependencySection: () => null,
}));
vi.mock("@/features/attachments/components/attachment-section", () => ({
  AttachmentSection: () => null,
}));
vi.mock("@/features/time/components/time-section", () => ({
  TimeSection: () => null,
}));

const LABELS: LabelData[] = [
  {
    id: 1,
    workspaceId: "ws-1",
    name: "bug",
    color: "red",
    createdAt: "2026-07-15T00:00:00.000Z",
  },
  {
    id: 2,
    workspaceId: "ws-1",
    name: "p0",
    color: "amber",
    createdAt: "2026-07-15T00:00:00.000Z",
  },
];

const MEMBERS: Member[] = [
  {
    userId: "u-alice",
    name: "Alice",
    email: "alice@example.test",
    image: null,
    role: "owner",
    createdAt: "2026-07-15T00:00:00.000Z",
  },
  {
    userId: "u-bob",
    name: "Bob",
    email: "bob@example.test",
    image: null,
    role: "member",
    createdAt: "2026-07-15T00:00:00.000Z",
  },
];

const AGENTS: AgentSummary[] = [
  { id: "a-triage", name: "Triage Bot", image: null, role: "member" },
];

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
    epicId: null,
    objectiveId: null,
    sprintId: null,
    value: null,
    risk: null,
    priorityScore: null,
    startDate: null,
    recurrence: null,
    attachmentCount: 0,
    checklist: { total: 0, done: 0 },
    customFields: [],
    claimedBy: null,
    claimedAt: null,
    createdAt: "2026-07-15T00:00:00.000Z",
    ...over,
  };
}

function renderDialog(over: { task?: Task } = {}) {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  render(
    <TaskDialog
      open
      task={over.task}
      columnNames={{ 1: "To Do" }}
      members={MEMBERS}
      agents={AGENTS}
      labels={LABELS}
      onOpenChange={vi.fn()}
      onSubmit={onSubmit}
    />
  );
  return { onSubmit };
}

const submit = () =>
  fireEvent.click(screen.getByRole("button", { name: /Save changes|Create task/ }));

/**
 * The picker's whole job is translating between a DOM value (always a string)
 * and the API's assignee — an Actor now (011), a person or an agent, or null to
 * unassign. That boundary is where the bugs live: "" is not an id, the kind has
 * to survive the round trip through a "type:id" value, and the wrong side of the
 * mapping either assigns to a principal whose id is the empty string or makes
 * unassigning impossible.
 */
describe("TaskDialog assignee picker", () => {
  it("offers every member and agent, plus nobody", () => {
    renderDialog();
    const picker = screen.getByLabelText("Assignee") as HTMLSelectElement;
    // Options flatten across the optgroups — people, then agents, then nobody.
    expect([...picker.options].map((o) => o.text)).toEqual([
      "Unassigned",
      "Alice",
      "Bob",
      "Triage Bot",
    ]);
  });

  it("shows the task's current assignee when opened, encoding its kind", () => {
    renderDialog({ task: task({ assignee: { type: "human", id: "u-bob" } }) });
    expect((screen.getByLabelText("Assignee") as HTMLSelectElement).value).toBe(
      "human:u-bob"
    );
  });

  it("submits the chosen member as a human Actor", async () => {
    const { onSubmit } = renderDialog({ task: task() });
    fireEvent.change(screen.getByLabelText("Assignee"), {
      target: { value: "human:u-bob" },
    });
    submit();

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ assignee: { type: "human", id: "u-bob" } })
      )
    );
  });

  it("submits the chosen agent as an agent Actor — the wedge in one field", async () => {
    const { onSubmit } = renderDialog({ task: task() });
    fireEvent.change(screen.getByLabelText("Assignee"), {
      target: { value: "agent:a-triage" },
    });
    submit();

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ assignee: { type: "agent", id: "a-triage" } })
      )
    );
  });

  it("submits null — not an empty string — when unassigning", async () => {
    // The one that matters. "" reaches the API as an id to look up, which is not
    // what "Unassigned" means, and no principal will ever match it.
    const { onSubmit } = renderDialog({
      task: task({ assignee: { type: "human", id: "u-bob" } }),
    });
    fireEvent.change(screen.getByLabelText("Assignee"), {
      target: { value: "" },
    });
    submit();

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ assignee: null })
      )
    );
  });

  it("defaults a new task to unassigned", async () => {
    const { onSubmit } = renderDialog();
    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "New task" },
    });
    submit();

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ title: "New task", assignee: null })
      )
    );
  });
});

/**
 * These two fields sit side by side in the form and behave differently on the
 * one axis that matters — what "empty" submits. The tests are next to each other
 * for the same reason: the bug this suite exists to catch is someone making them
 * consistent.
 */
describe("TaskDialog priority", () => {
  it("offers the priorities highest-first", () => {
    // Order is not decoration here: the enum is stored lowest-first because that
    // is a sort order, and the menu reverses it because raising a priority is
    // why anyone opens the menu. A test, so the reverse cannot quietly vanish.
    const picker = (renderDialog(), screen.getByLabelText(
      "Priority"
    ) as HTMLSelectElement);
    expect([...picker.options].map((o) => o.text)).toEqual([
      "Urgent",
      "High",
      "Medium",
      "Low",
      "No priority",
    ]);
  });

  it("defaults a new task to none", async () => {
    const { onSubmit } = renderDialog();
    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "New task" },
    });
    submit();

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ priority: "none" })
      )
    );
  });

  it("shows the task's current priority when opened", () => {
    renderDialog({ task: task({ priority: "high" }) });
    expect((screen.getByLabelText("Priority") as HTMLSelectElement).value).toBe(
      "high"
    );
  });

  it("submits 'none' — not null — when the priority is cleared", async () => {
    // The counterpart to the assignee test above, and deliberately the opposite
    // assertion. 'none' is a value, so it travels as one; a null here would be
    // read as "not supplied" by the repository's COALESCE and silently leave the
    // old priority in place.
    const { onSubmit } = renderDialog({ task: task({ priority: "urgent" }) });
    fireEvent.change(screen.getByLabelText("Priority"), {
      target: { value: "none" },
    });
    submit();

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ priority: "none" })
      )
    );
  });
});

describe("TaskDialog due date", () => {
  it("shows the task's current due date when opened", () => {
    renderDialog({ task: task({ dueDate: "2026-08-01" }) });
    expect((screen.getByLabelText("Due date") as HTMLInputElement).value).toBe(
      "2026-08-01"
    );
  });

  it("submits the date exactly as the input reports it", async () => {
    // No parsing, no formatting, no Date in between — the input's value is
    // already the 'YYYY-MM-DD' the API wants. Anything that "helpfully" converts
    // this is what puts a timezone back into a zoneless field.
    const { onSubmit } = renderDialog({ task: task() });
    fireEvent.change(screen.getByLabelText("Due date"), {
      target: { value: "2026-08-01" },
    });
    submit();

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ dueDate: "2026-08-01" })
      )
    );
  });

  it("submits null — not an empty string — when the date is cleared", async () => {
    // Same shape as the assignee case, and the same reason: "" is a DOM
    // artifact. It would reach the API as a malformed date and be rejected,
    // making a due date impossible to remove once set.
    const { onSubmit } = renderDialog({ task: task({ dueDate: "2026-08-01" }) });
    fireEvent.change(screen.getByLabelText("Due date"), {
      target: { value: "" },
    });
    submit();

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ dueDate: null })
      )
    );
  });
});

describe("TaskDialog label picker", () => {
  const openPicker = async () => {
    fireEvent.click(screen.getByRole("button", { name: /Add labels|selected/ }));
    // Base UI does not render popup children while closed, so the menu has to be
    // opened for real — the same reason board-column.test.tsx does this.
    return screen.findByRole("menuitemcheckbox", { name: /bug/ });
  };

  it("offers the workspace's vocabulary and no way to add to it", async () => {
    // The design, not an omission. A task dialog that can mint a label is how a
    // controlled set rots back into free text: every hurried edit adds one, and
    // 007's whole value — that an agent chooses rather than invents — goes with
    // it. This test is what a well-meaning "just let me type a new one here"
    // change has to break in order to land.
    renderDialog({ task: task() });
    await openPicker();

    expect(screen.getByRole("menuitemcheckbox", { name: /bug/ })).toBeDefined();
    expect(screen.getByRole("menuitemcheckbox", { name: /p0/ })).toBeDefined();
    expect(screen.queryByPlaceholderText(/new label/i)).toBeNull();
  });

  it("shows the task's current labels as checked", async () => {
    renderDialog({ task: task({ labels: [{ id: 2, name: "p0" }] }) });
    await openPicker();

    expect(
      screen.getByRole("menuitemcheckbox", { name: /p0/ })
    ).toHaveProperty("ariaChecked", "true");
    expect(
      screen.getByRole("menuitemcheckbox", { name: /bug/ })
    ).toHaveProperty("ariaChecked", "false");
  });

  it("submits ids, not names", async () => {
    // The task carries {id, name} because the log needs the name; the form's
    // business is which labels. The API takes ids.
    const { onSubmit } = renderDialog({ task: task() });
    fireEvent.click(await openPicker());
    submit();

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ labelIds: [1] })
      )
    );
  });

  it("submits [] — not null — when the last label is unticked", async () => {
    // The third field in this suite to be asked what "empty" submits, and the
    // second to answer with a value rather than null. A set has an empty value,
    // so nothing here has to be three-valued (006's rule).
    const { onSubmit } = renderDialog({ task: task({ labels: [{ id: 1, name: "bug" }] }) });
    fireEvent.click(await openPicker());
    submit();

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ labelIds: [] })
      )
    );
  });

  it("stays open while several labels are picked", async () => {
    // A CheckboxItem rather than an Item is what buys this. Picking three labels
    // through a menu that closes on each tick is three trips.
    const { onSubmit } = renderDialog({ task: task() });
    fireEvent.click(await openPicker());
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: /p0/ }));
    submit();

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ labelIds: [1, 2] })
      )
    );
  });
});

/**
 * A subtask is edited by this same dialog — "a subtask is a whole task" is the
 * whole design — with two differences from a top-level task, and both are here.
 * It gains a Status control, because a piece is never on the board and so cannot
 * be dragged between columns; and it gains a way back to the parent it decomposes,
 * because that parent is the only place it was reached from.
 */
describe("TaskDialog subtask", () => {
  const COLUMNS = [
    { id: 1, title: "To Do" },
    { id: 2, title: "Doing" },
    { id: 3, title: "Done" },
  ];

  function renderSubtaskDialog(
    over: Partial<React.ComponentProps<typeof TaskDialog>> = {}
  ) {
    const onMoveSubtask = vi.fn();
    const onBack = vi.fn();
    render(
      <TaskDialog
        open
        task={task({ id: 11, parentId: 5, columnId: 2 })}
        parentTask={task({ id: 5, title: "build auth" })}
        columnNames={{ 1: "To Do", 2: "Doing", 3: "Done" }}
        columns={COLUMNS}
        members={MEMBERS}
        agents={AGENTS}
        labels={LABELS}
        onOpenChange={vi.fn()}
        onSubmit={vi.fn().mockResolvedValue(undefined)}
        onMoveSubtask={onMoveSubtask}
        onBack={onBack}
        {...over}
      />
    );
    return { onMoveSubtask, onBack };
  }

  it("offers a Status control set to the piece's current column", () => {
    // The one field a piece has that a top-level task edits by dragging. A piece
    // cannot be dragged — it is not on the board — so this is where its status
    // lives.
    renderSubtaskDialog();
    const status = screen.getByLabelText("Status") as HTMLSelectElement;
    expect([...status.options].map((o) => o.text)).toEqual([
      "To Do",
      "Doing",
      "Done",
    ]);
    expect(status.value).toBe("2");
  });

  it("moves the piece the moment its status changes, not on save", () => {
    // A move is its own mutation, committed when made — exactly as dragging a
    // card commits one on drop. Waiting for "Save changes" would make status the
    // odd field out; firing here makes it the same event a drag is.
    const { onMoveSubtask } = renderSubtaskDialog();
    fireEvent.change(screen.getByLabelText("Status"), {
      target: { value: "3" },
    });
    expect(onMoveSubtask).toHaveBeenCalledWith(11, 3);
  });

  it("offers a way back to the parent it decomposes", () => {
    const { onBack } = renderSubtaskDialog();
    fireEvent.click(screen.getByRole("button", { name: /build auth/ }));
    expect(onBack).toHaveBeenCalled();
  });

  it("gives a top-level task no Status control", () => {
    // The control is a subtask's alone. A top-level task moves by drag on the
    // board, so a Status select here would be a second, redundant way to do it.
    render(
      <TaskDialog
        open
        task={task()}
        columnNames={{ 1: "To Do" }}
        columns={COLUMNS}
        members={MEMBERS}
        agents={AGENTS}
        labels={LABELS}
        onOpenChange={vi.fn()}
        onSubmit={vi.fn()}
      />
    );
    expect(screen.queryByLabelText("Status")).toBeNull();
  });
});
