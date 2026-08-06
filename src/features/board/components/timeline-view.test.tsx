// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { CustomField } from "@/features/custom-fields/types";
import type { Task } from "@/features/tasks/types";
import { TimelineView } from "./timeline-view";
import type { Column } from "../types";

/**
 * The schedule lenses' custom-field annotation (the 035 follow-up), where it is
 * actually visible. `fieldAnnotation` is unit-tested next door; what this covers
 * is the wiring the pure test cannot see — that the lens reads the board's
 * fields at all, that the picker appears only when there is something to pick,
 * and that an answer reaches the bar.
 */

const column: Column = {
  id: 1,
  boardId: 1,
  title: "To Do",
  position: 0,
  wipLimit: null,
};

const task = (over: Partial<Task> = {}): Task =>
  ({
    id: 1,
    columnId: 1,
    title: "Rebuild the carburettor",
    description: "",
    position: 0,
    assignee: null,
    priority: "none",
    type: "task",
    estimate: null,
    milestoneId: null,
    sprintId: null,
    epicId: null,
    objectiveId: null,
    value: null,
    risk: null,
    priorityScore: null,
    startDate: "2026-08-01",
    dueDate: "2026-08-10",
    parentId: null,
    claimedBy: null,
    claimedAt: null,
    claimExpiresAt: null,
    createdAt: "2026-07-01T00:00:00.000Z",
    labels: [],
    customFields: [],
    subtaskCount: 0,
    blockedByCount: 0,
    blockedByOpenCount: 0,
    recurrence: null,
    attachmentCount: 0,
    checklist: { total: 0, done: 0 },
    ...over,
  }) as Task;

const clientField: CustomField = {
  id: 4,
  boardId: 1,
  name: "Client",
  type: "text",
  options: [],
  position: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
};

function renderTimeline(
  over: Partial<React.ComponentProps<typeof TimelineView>> = {}
) {
  return render(
    <TimelineView
      columns={[column]}
      itemsByColumn={{ 1: [task()] }}
      membersById={{}}
      agentsById={{}}
      labelsById={{}}
      onEditTask={vi.fn()}
      {...over}
    />
  );
}

describe("TimelineView custom-field annotation", () => {
  it("offers no picker on a board with no custom fields", () => {
    renderTimeline();
    expect(
      screen.queryByLabelText("Annotate bars with a custom field")
    ).toBeNull();
  });

  it("offers the board's fields once there are any", () => {
    renderTimeline({ customFieldsById: { 4: clientField } });
    expect(
      screen.getByLabelText("Annotate bars with a custom field")
    ).toBeDefined();
    // Nothing is annotated until a field is picked — the default is None, so a
    // lens that nobody has configured looks exactly as it did before.
    expect(screen.queryByText("Acme")).toBeNull();
  });

  it("shows the chosen field's answer on the bar", () => {
    renderTimeline({
      customFieldsById: { 4: clientField },
      annotateWith: 4,
      itemsByColumn: {
        1: [task({ customFields: [{ fieldId: 4, value: "Acme" }] })],
      },
    });
    expect(screen.getByText("Acme")).toBeDefined();
    // And it reaches the tooltip too, named, since a truncated bar is exactly
    // when a reader hovers.
    expect(
      screen.getByTitle(/Rebuild the carburettor .* Client: Acme/)
    ).toBeDefined();
  });

  it("annotates nothing for a task that never answered", () => {
    renderTimeline({
      customFieldsById: { 4: clientField },
      annotateWith: 4,
      itemsByColumn: { 1: [task()] },
    });
    // The bar is still there; it simply says nothing extra.
    expect(screen.getByText("Rebuild the carburettor")).toBeDefined();
    expect(screen.queryByText("Acme")).toBeNull();
    expect(screen.queryByTitle(/Client:/)).toBeNull();
  });
});
