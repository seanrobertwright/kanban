// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Member } from "@/features/workspaces/types";
import { TaskDialog } from "./task-dialog";
import type { Task } from "../types";

// The dialog mounts the feed for an existing task, which would otherwise fetch.
vi.mock("@/features/activity/components/activity-feed", () => ({
  ActivityFeed: () => null,
}));

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

function task(over: Partial<Task> = {}): Task {
  return {
    id: 7,
    columnId: 1,
    title: "A task",
    description: "",
    position: 0,
    assigneeId: null,
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
 * and the API's three-valued assignee (a user id, or null to unassign). That
 * boundary is where the bugs live: "" is not a user id, and the wrong side of
 * this mapping either assigns a task to a user whose id is the empty string, or
 * makes unassigning impossible.
 */
describe("TaskDialog assignee picker", () => {
  it("offers every member, plus nobody", () => {
    renderDialog();
    const picker = screen.getByLabelText("Assignee") as HTMLSelectElement;
    expect([...picker.options].map((o) => o.text)).toEqual([
      "Unassigned",
      "Alice",
      "Bob",
    ]);
  });

  it("shows the task's current assignee when opened", () => {
    renderDialog({ task: task({ assigneeId: "u-bob" }) });
    expect((screen.getByLabelText("Assignee") as HTMLSelectElement).value).toBe(
      "u-bob"
    );
  });

  it("submits the chosen member's id", async () => {
    const { onSubmit } = renderDialog({ task: task() });
    fireEvent.change(screen.getByLabelText("Assignee"), {
      target: { value: "u-bob" },
    });
    submit();

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ assigneeId: "u-bob" })
      )
    );
  });

  it("submits null — not an empty string — when unassigning", async () => {
    // The one that matters. "" reaches the API as a user id to look up, which
    // is not what "Unassigned" means, and no member will ever match it.
    const { onSubmit } = renderDialog({ task: task({ assigneeId: "u-bob" }) });
    fireEvent.change(screen.getByLabelText("Assignee"), {
      target: { value: "" },
    });
    submit();

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ assigneeId: null })
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
        expect.objectContaining({ title: "New task", assigneeId: null })
      )
    );
  });
});
