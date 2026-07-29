import { describe, expect, it } from "vitest";

import { proposeSchedule, type SchedulableTask } from "./schedule-proposal";
import {
  DEFAULT_LINK,
  type DependencyLink,
  type TaskDependencyEdge,
} from "@/features/dependencies/types";

const START = "2026-07-01";

/** Unassigned by default: an assignee shares a lane, and lane sequencing would
 * mask what a link is doing by pushing the dependent along anyway. */
function task(
  id: number,
  estimate: number,
  over: Partial<SchedulableTask> = {}
): SchedulableTask {
  return {
    id,
    title: `T${id}`,
    estimate,
    startDate: null,
    dueDate: null,
    assigneeId: null,
    ...over,
  };
}

const edge = (
  taskId: number,
  dependsOnId: number,
  link: DependencyLink = DEFAULT_LINK
): TaskDependencyEdge => ({ taskId, dependsOnId, ...link });

/** The proposal for one task, by id — the list is sorted by start date. */
const forTask = (result: ReturnType<typeof proposeSchedule>, id: number) =>
  result.find((p) => p.taskId === id)!;

describe("proposeSchedule", () => {
  it("places dependent work after its blocker", () => {
    const result = proposeSchedule(
      [
        task(1, 2, { assigneeId: "u" }),
        task(2, 1, { assigneeId: "u" }),
      ],
      [edge(2, 1)],
      START
    );
    expect(result).toEqual([
      {
        taskId: 1,
        startDate: "2026-07-01",
        dueDate: "2026-07-02",
        reasons: ["next available schedule slot"],
      },
      {
        taskId: 2,
        startDate: "2026-07-03",
        dueDate: "2026-07-03",
        reasons: ["after dependency #1"],
      },
    ]);
  });

  it("uses a member's weekly point budget to derive duration", () => {
    const result = proposeSchedule(
      [task(1, 5, { assigneeId: "u" })],
      [],
      START,
      new Map([["u", 10]])
    );
    expect(result).toEqual([
      {
        taskId: 1,
        startDate: "2026-07-01",
        dueDate: "2026-07-04",
        reasons: ["fits 5 points into 10 points/week capacity"],
      },
    ]);
  });
});

/**
 * Each case is a plan the pre-087 proposer would have got wrong, because it
 * could only ever put the dependent on the day after its blocker ended.
 */
describe("proposeSchedule typed links (087)", () => {
  it("holds the dependent back by the lag, not just past the end", () => {
    // A runs 1st–2nd; a week of lag means B starts on the 10th, not the 3rd.
    const result = proposeSchedule(
      [task(1, 2), task(2, 1)],
      [edge(2, 1, { type: "FS", lagDays: 7 })],
      START
    );
    expect(forTask(result, 2)).toMatchObject({
      startDate: "2026-07-10",
      dueDate: "2026-07-10",
      reasons: ["after dependency #1 (FS+7d)"],
    });
  });

  it("overlaps the two tasks when the lag is a lead", () => {
    // A runs 1st–4th. −2 days pulls B's start back into A's tail: it begins on
    // the 3rd, while A still has two days to run.
    const result = proposeSchedule(
      [task(1, 4), task(2, 2)],
      [edge(2, 1, { type: "FS", lagDays: -2 })],
      START
    );
    expect(forTask(result, 2)).toMatchObject({
      startDate: "2026-07-03",
      dueDate: "2026-07-04",
      reasons: ["after dependency #1 (FS−2d)"],
    });
  });

  it("starts a start-to-start pair together", () => {
    // Nothing to wait for: B may begin the same day A does, so the blocker
    // never pushes it and is not named as a reason — the link is satisfied
    // where B already sits.
    const result = proposeSchedule(
      [task(1, 4), task(2, 2)],
      [edge(2, 1, { type: "SS", lagDays: 0 })],
      START
    );
    expect(forTask(result, 2)).toMatchObject({
      startDate: "2026-07-01",
      reasons: ["next available schedule slot"],
    });
  });

  it("staggers a start-to-start pair by its lag", () => {
    const result = proposeSchedule(
      [task(1, 4), task(2, 2)],
      [edge(2, 1, { type: "SS", lagDays: 2 })],
      START
    );
    expect(forTask(result, 2)).toMatchObject({
      startDate: "2026-07-03",
      dueDate: "2026-07-04",
      reasons: ["after dependency #1 (SS+2d)"],
    });
  });

  it("lands a finish-to-finish pair on the same day", () => {
    // A runs 1st–8th. B is two days long and must finish with A, so it starts
    // on the 7th — a date the old proposer could not produce at all, since it
    // only ever pushed a dependent past its blocker's end.
    const result = proposeSchedule(
      [task(1, 8), task(2, 2)],
      [edge(2, 1, { type: "FF", lagDays: 0 })],
      START
    );
    expect(forTask(result, 1)).toMatchObject({ dueDate: "2026-07-08" });
    expect(forTask(result, 2)).toMatchObject({
      startDate: "2026-07-07",
      dueDate: "2026-07-08",
      reasons: ["after dependency #1 (FF)"],
    });
  });

  it("takes the latest of several links rather than the last one read", () => {
    // Two blockers with different link types. The date walks forward to whatever
    // pushes it furthest, and each blocker that moved it is named in the order
    // it did so — the trail of how the date was arrived at, not just its cause.
    const result = proposeSchedule(
      [task(1, 2), task(2, 3), task(3, 1)],
      [
        edge(3, 1, { type: "FS", lagDays: 0 }), // ready on the 3rd
        edge(3, 2, { type: "SS", lagDays: 5 }), // ready on the 6th
      ],
      START
    );
    expect(forTask(result, 3)).toMatchObject({
      startDate: "2026-07-06",
      reasons: ["after dependency #1", "after dependency #2 (SS+5d)"],
    });
  });

  it("still queues one assignee's tasks after the link is satisfied", () => {
    // The SS link says they may start together; the shared lane says one person
    // cannot actually do that. Capacity wins, and says so.
    const result = proposeSchedule(
      [task(1, 3, { assigneeId: "u" }), task(2, 2, { assigneeId: "u" })],
      [edge(2, 1, { type: "SS", lagDays: 0 })],
      START
    );
    expect(forTask(result, 2)).toMatchObject({
      startDate: "2026-07-04",
      reasons: ["after assignee's planned work"],
    });
  });
});
