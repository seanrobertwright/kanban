// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Epic } from "@/features/epics/types";
import type { Milestone } from "@/features/milestones/types";
import { RoadmapView } from "./roadmap-view";

/**
 * The roadmap's empty state (UI-2). The view already opens the Milestones dialog
 * from every marker it draws; the case this covers is the one where it draws
 * none, which is exactly when a user has nothing else to click.
 */

const epic = (over: Partial<Epic> = {}): Epic =>
  ({
    id: 1,
    boardId: 1,
    name: "Engine",
    description: "",
    colour: null,
    createdAt: "2026-07-01T00:00:00.000Z",
    ...over,
  }) as Epic;

const milestone = (over: Partial<Milestone> = {}): Milestone =>
  ({
    id: 1,
    boardId: 1,
    name: "Rolling chassis",
    dueDate: "2026-08-20",
    epicId: 1,
    objectiveId: null,
    createdAt: "2026-07-01T00:00:00.000Z",
    total: 4,
    done: 1,
    ...over,
  }) as Milestone;

describe("RoadmapView", () => {
  it("opens Milestones from its empty state", () => {
    const onOpenMilestones = vi.fn();
    render(
      <RoadmapView
        milestones={[]}
        epics={[]}
        onOpenMilestones={onOpenMilestones}
      />
    );

    // The copy has to survive: it names the two things a milestone needs, which
    // is why someone lands here able to act at all.
    expect(screen.getByText(/no milestones yet/i)).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: /milestone/i }));
    expect(onOpenMilestones).toHaveBeenCalledTimes(1);
  });

  // The positive control for the above: the callback was always wired to a drawn
  // marker, so a test that only ever rendered milestones would pass against the
  // bug. This is the half that was working.
  it("still opens Milestones from a drawn marker", () => {
    const onOpenMilestones = vi.fn();
    render(
      <RoadmapView
        milestones={[milestone()]}
        epics={[epic()]}
        onOpenMilestones={onOpenMilestones}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /rolling chassis/i }));
    expect(onOpenMilestones).toHaveBeenCalledTimes(1);
  });
});
