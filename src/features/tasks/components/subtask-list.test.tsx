// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SubtaskList } from "./subtask-list";
import type { Task } from "../types";

// The list owns its own create/delete against the API and refetches after each,
// exactly as CommentThread does — so the API is the seam the tests drive.
const { createTask, deleteTask, fetchSubtasks } = vi.hoisted(() => ({
  createTask: vi.fn(),
  deleteTask: vi.fn(),
  fetchSubtasks: vi.fn(),
}));

vi.mock("../client/api", () => ({ createTask, deleteTask, fetchSubtasks }));

function subtask(over: Partial<Task> = {}): Task {
  return {
    id: 11,
    columnId: 2,
    title: "a piece",
    description: "",
    position: 0,
    assignee: null,
    priority: "none",
    dueDate: null,
    labels: [],
    parentId: 1,
    subtaskCount: 0,
    blockedByCount: 0,
    checklist: { total: 0, done: 0 },
    claimedBy: null,
    claimedAt: null,
    createdAt: "2026-07-15T00:00:00.000Z",
    ...over,
  };
}

const COLUMN_NAMES = { 1: "To Do", 2: "Doing", 3: "Done" };

function renderList(over: Partial<React.ComponentProps<typeof SubtaskList>> = {}) {
  const onOpenSubtask = vi.fn();
  const onChanged = vi.fn();
  render(
    <SubtaskList
      parentId={1}
      defaultColumnId={1}
      columnNames={COLUMN_NAMES}
      onOpenSubtask={onOpenSubtask}
      onChanged={onChanged}
      {...over}
    />
  );
  return { onOpenSubtask, onChanged };
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchSubtasks.mockResolvedValue([]);
  createTask.mockResolvedValue(subtask());
  deleteTask.mockResolvedValue(undefined);
});

describe("SubtaskList display", () => {
  it("lists each piece with its title and its status", async () => {
    // The status is the fact worth surfacing: a piece flows through the workflow
    // independently of the thing it decomposes, so "which column" is what the
    // reader is here to see (008).
    fetchSubtasks.mockResolvedValue([
      subtask({ id: 11, title: "add login route", columnId: 2 }),
      subtask({ id: 12, title: "session middleware", columnId: 1 }),
    ]);
    renderList();

    expect(await screen.findByText("add login route")).toBeDefined();
    expect(screen.getByText("session middleware")).toBeDefined();
    // Column names, resolved the way the board resolves them.
    expect(screen.getByText("Doing")).toBeDefined();
    expect(screen.getByText("To Do")).toBeDefined();
  });

  it("opens a piece in the task editor when its row is clicked", async () => {
    // A subtask is a whole task, so a row hands the piece back to be edited by the
    // one surface that already knows how — not a second, thinner editor.
    const piece = subtask({ id: 11, title: "add login route" });
    fetchSubtasks.mockResolvedValue([piece]);
    const { onOpenSubtask } = renderList();

    fireEvent.click(await screen.findByText("add login route"));
    expect(onOpenSubtask).toHaveBeenCalledWith(piece);
  });

  it("says so when there are no pieces yet", async () => {
    renderList();
    expect(await screen.findByText("No subtasks yet.")).toBeDefined();
  });
});

describe("SubtaskList create", () => {
  it("creates a piece with the parent id and the board's first column", async () => {
    // No createSubtask: a subtask is a task, so this is createTask with a
    // parentId (fetchSubtasks). The column is the default, not the parent's —
    // new work enters at the front of the workflow.
    const { onChanged } = renderList({ parentId: 7, defaultColumnId: 1 });
    fireEvent.change(await screen.findByLabelText("New subtask title"), {
      target: { value: "  write the migration  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() =>
      expect(createTask).toHaveBeenCalledWith({
        columnId: 1,
        title: "write the migration",
        parentId: 7,
      })
    );
    // Refetches and tells the board its count is stale.
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(fetchSubtasks).toHaveBeenCalledTimes(2);
  });

  it("adds on Enter without submitting the surrounding form", async () => {
    // The list lives inside the dialog's task form; the default Enter-submits
    // behaviour would save the parent task instead. preventDefault is what stops
    // that, and this is the test a regression has to break.
    const form = document.createElement("form");
    const onSubmit = vi.fn((e: Event) => e.preventDefault());
    form.addEventListener("submit", onSubmit);
    render(
      <SubtaskList
        parentId={1}
        defaultColumnId={1}
        columnNames={COLUMN_NAMES}
        onOpenSubtask={vi.fn()}
      />,
      { container: document.body.appendChild(form) }
    );

    const input = await screen.findByLabelText("New subtask title");
    fireEvent.change(input, { target: { value: "a piece" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(createTask).toHaveBeenCalled());
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("cannot add a piece when the board has no column to hold it", async () => {
    // defaultColumnId is null only when the board has no columns at all. A piece
    // needs somewhere to live, so the control disables rather than posting one
    // with nowhere to go.
    renderList({ defaultColumnId: null });
    expect(
      (await screen.findByLabelText("New subtask title")) as HTMLInputElement
    ).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Add" })).toHaveProperty(
      "disabled",
      true
    );
  });
});

describe("SubtaskList delete", () => {
  it("takes two clicks, so a slip does not lose a piece", async () => {
    // No undo until M2, so the second click is the only guard. A confirm() would
    // be a modal inside a modal, blocking the page.
    fetchSubtasks.mockResolvedValue([subtask({ id: 11, title: "a piece" })]);
    renderList();

    const del = await screen.findByRole("button", { name: "Delete a piece" });
    fireEvent.click(del);
    // Not deleted yet — it armed instead.
    expect(deleteTask).not.toHaveBeenCalled();
    const confirm = screen.getByRole("button", { name: "Confirm delete a piece" });
    fireEvent.click(confirm);

    await waitFor(() => expect(deleteTask).toHaveBeenCalledWith(11));
  });
});
