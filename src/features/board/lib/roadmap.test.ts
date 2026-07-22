import { describe, expect, it } from "vitest";

import type { Epic } from "@/features/epics/types";
import type { Milestone } from "@/features/milestones/types";
import { buildRoadmap } from "./roadmap";

/**
 * Pure roadmap grouping (038) — no database. Same date discipline as schedule.ts:
 * offsets are whole-day diffs on 'YYYY-MM-DD' strings, never local-zone Dates.
 */

let nextId = 1;
function milestone(over: Partial<Milestone> = {}): Milestone {
  return {
    id: nextId++,
    boardId: 1,
    name: "M",
    dueDate: null,
    epicId: null,
    objectiveId: null,
    createdAt: "2026-07-01T00:00:00.000Z",
    total: 0,
    done: 0,
    ...over,
  };
}
function epic(id: number, name: string): Epic {
  return { id, boardId: 1, name, createdAt: "2026-07-01T00:00:00.000Z", total: 0, done: 0 };
}

describe("buildRoadmap", () => {
  it("has no window when nothing is dated", () => {
    const { window, lanes } = buildRoadmap(
      [milestone({ epicId: 7 })],
      [epic(7, "Billing")]
    );
    expect(window).toBeNull();
    // The lane still exists, holding the milestone as undated.
    expect(lanes).toHaveLength(1);
    expect(lanes[0].undated).toHaveLength(1);
    expect(lanes[0].dated).toHaveLength(0);
  });

  it("pads the window two days each side of the dated extent", () => {
    const { window } = buildRoadmap(
      [
        milestone({ dueDate: "2026-08-10" }),
        milestone({ dueDate: "2026-08-20" }),
      ],
      []
    );
    expect(window).toEqual({ start: "2026-08-08", end: "2026-08-22", total: 15 });
  });

  it("offsets a marker in whole days from the padded window start", () => {
    const { window, lanes } = buildRoadmap(
      [milestone({ dueDate: "2026-08-10", epicId: null })],
      []
    );
    // Window starts two days before the only date, so the marker sits at +2.
    expect(window!.start).toBe("2026-08-08");
    expect(lanes[0].dated[0].offset).toBe(2);
  });

  it("groups milestones into epic lanes in board order, Unfiled last", () => {
    const { lanes } = buildRoadmap(
      [
        milestone({ epicId: 2, dueDate: "2026-08-05" }),
        milestone({ epicId: 1, dueDate: "2026-08-06" }),
        milestone({ epicId: null, dueDate: "2026-08-07" }),
      ],
      [epic(1, "Onboarding"), epic(2, "Billing")]
    );
    expect(lanes.map((l) => l.epicName)).toEqual([
      "Onboarding",
      "Billing",
      "Unfiled",
    ]);
  });

  it("skips an epic with no milestones", () => {
    const { lanes } = buildRoadmap(
      [milestone({ epicId: 1, dueDate: "2026-08-05" })],
      [epic(1, "Onboarding"), epic(2, "Empty")]
    );
    expect(lanes.map((l) => l.epicName)).toEqual(["Onboarding"]);
  });

  it("sorts a lane's dated markers earliest-first and buckets the undated", () => {
    const { lanes } = buildRoadmap(
      [
        milestone({ epicId: 1, dueDate: "2026-08-20", name: "late" }),
        milestone({ epicId: 1, dueDate: "2026-08-10", name: "early" }),
        milestone({ epicId: 1, dueDate: null, name: "someday" }),
      ],
      [epic(1, "Onboarding")]
    );
    expect(lanes[0].dated.map((d) => d.milestone.name)).toEqual([
      "early",
      "late",
    ]);
    expect(lanes[0].undated.map((m) => m.name)).toEqual(["someday"]);
  });

  it("rolls a lane's total/done up from its milestones", () => {
    const { lanes } = buildRoadmap(
      [
        milestone({ epicId: 1, total: 4, done: 1 }),
        milestone({ epicId: 1, total: 6, done: 5 }),
      ],
      [epic(1, "Onboarding")]
    );
    expect(lanes[0].total).toBe(10);
    expect(lanes[0].done).toBe(6);
  });
});
