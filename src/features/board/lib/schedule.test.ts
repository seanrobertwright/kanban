import { describe, expect, it } from "vitest";

import {
  DEFAULT_LINK,
  type DependencyLink,
  type TaskDependencyEdge,
} from "@/features/dependencies/types";
import type { Task } from "@/features/tasks/types";
import {
  addDays,
  criticalPath,
  dayDiff,
  durationOf,
  edgeKey,
  spanOf,
} from "./schedule";

/**
 * Pure scheduling maths — no database. The date helpers must never drift a day
 * through a local zone (006's trap), and the critical path is the CPM
 * longest-weighted-path the Gantt highlights (036).
 */

/** A minimal task carrying only the fields spanOf reads. */
function task(startDate: string | null, dueDate: string | null): Task {
  return { startDate, dueDate } as unknown as Task;
}

describe("date helpers", () => {
  it("adds days across a month boundary in UTC", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("counts whole days between dates, signed", () => {
    expect(dayDiff("2026-07-01", "2026-07-08")).toBe(7);
    expect(dayDiff("2026-07-08", "2026-07-01")).toBe(-7);
    expect(dayDiff("2026-07-01", "2026-07-01")).toBe(0);
  });
});

describe("spanOf / durationOf", () => {
  it("spans start to due", () => {
    expect(spanOf(task("2026-07-01", "2026-07-05"))).toEqual([
      "2026-07-01",
      "2026-07-05",
    ]);
  });

  it("treats a lone date as a zero-length span on that day", () => {
    expect(spanOf(task("2026-07-03", null))).toEqual(["2026-07-03", "2026-07-03"]);
    expect(spanOf(task(null, "2026-07-03"))).toEqual(["2026-07-03", "2026-07-03"]);
  });

  it("has no span when neither date is set", () => {
    expect(spanOf(task(null, null))).toBeNull();
  });

  it("orders a backwards pair forward", () => {
    expect(spanOf(task("2026-07-10", "2026-07-01"))).toEqual([
      "2026-07-01",
      "2026-07-10",
    ]);
  });

  it("counts duration inclusive of both endpoints", () => {
    expect(durationOf(["2026-07-01", "2026-07-01"])).toBe(1);
    expect(durationOf(["2026-07-01", "2026-07-05"])).toBe(5);
  });
});

describe("criticalPath", () => {
  const dur = (entries: [number, number][]) => new Map<number, number>(entries);
  // Plain finish-to-start with no offset unless a case says otherwise — the only
  // link 018 could express, and what every one of these cases meant before 087.
  const edge = (
    taskId: number,
    dependsOnId: number,
    link: DependencyLink = DEFAULT_LINK
  ): TaskDependencyEdge => ({ taskId, dependsOnId, ...link });

  it("is empty with no edges", () => {
    const cp = criticalPath(dur([[1, 3], [2, 5]]), []);
    expect(cp.nodes.size).toBe(0);
    expect(cp.edges.size).toBe(0);
  });

  it("marks the longer of two parallel chains", () => {
    // 1 → 2 (durations 2 + 2 = 4) versus 3 → 4 (durations 5 + 5 = 10).
    const durations = dur([[1, 2], [2, 2], [3, 5], [4, 5]]);
    const edges = [edge(2, 1), edge(4, 3)];
    const cp = criticalPath(durations, edges);
    expect([...cp.nodes].sort()).toEqual([3, 4]);
    expect(cp.edges.has(edgeKey(3, 4))).toBe(true);
    expect(cp.edges.has(edgeKey(1, 2))).toBe(false);
  });

  it("follows the heaviest path through a diamond", () => {
    // 1 → {2, 3} → 4. The 1→3→4 arm (1+5+1=7) beats 1→2→4 (1+1+1=3).
    const durations = dur([[1, 1], [2, 1], [3, 5], [4, 1]]);
    const edges = [edge(2, 1), edge(3, 1), edge(4, 2), edge(4, 3)];
    const cp = criticalPath(durations, edges);
    expect([...cp.nodes].sort()).toEqual([1, 3, 4]);
    expect(cp.edges.has(edgeKey(1, 3))).toBe(true);
    expect(cp.edges.has(edgeKey(3, 4))).toBe(true);
    expect(cp.edges.has(edgeKey(1, 2))).toBe(false);
    expect(cp.edges.has(edgeKey(2, 4))).toBe(false);
  });

  it("ignores edges touching an off-board task", () => {
    // Task 99 has no bar (a subtask), so its edge is dropped and 1→2 stands.
    const durations = dur([[1, 3], [2, 3]]);
    const edges = [edge(2, 1), edge(1, 99)];
    const cp = criticalPath(durations, edges);
    expect([...cp.nodes].sort()).toEqual([1, 2]);
    expect(cp.edges.has(edgeKey(1, 2))).toBe(true);
  });

  it("does not loop on a stray cycle", () => {
    // addDependency forbids this, but a hand-edited edge must not hang the view.
    const durations = dur([[1, 2], [2, 2]]);
    const edges = [edge(2, 1), edge(1, 2)];
    expect(() => criticalPath(durations, edges)).not.toThrow();
  });

  /**
   * A typed link changes how much of the blocker has to be behind you, so it
   * changes which chain is longest — the thing the whole view is drawn from.
   * Each case here is a board where the pre-087 duration-sum answer would have
   * been wrong.
   */
  describe("typed links and lag (087)", () => {
    const SS = (lagDays = 0): DependencyLink => ({ type: "SS", lagDays });
    const FF = (lagDays = 0): DependencyLink => ({ type: "FF", lagDays });

    it("lets a start-to-start pair run together instead of end to end", () => {
      // 1 → 2 as SS means 2 starts with 1, not after it, so the pair spans
      // max(4, 4) = 4 days rather than 8 — short enough that the parallel 3 → 4
      // chain (5 + 5, all FS) is now the one driving the schedule.
      const durations = dur([[1, 4], [2, 4], [3, 5], [4, 5]]);
      const cp = criticalPath(durations, [edge(2, 1, SS()), edge(4, 3)]);
      expect([...cp.nodes].sort()).toEqual([3, 4]);
    });

    it("counts lag as part of the chain, not free time", () => {
      // The 1 → 2 arm is 2 + 2 days of work, but the link makes 2 wait a further
      // week: 2 + 7 + 2 = 11 beats the 5 + 5 = 10 arm beside it. Nothing about
      // the durations says so — only the lag does.
      const durations = dur([[1, 2], [2, 2], [3, 5], [4, 5]]);
      const cp = criticalPath(durations, [
        edge(2, 1, { type: "FS", lagDays: 7 }),
        edge(4, 3),
      ]);
      expect([...cp.nodes].sort()).toEqual([1, 2]);
      expect(cp.edges.has(edgeKey(1, 2))).toBe(true);
    });

    it("treats a lead as an overlap that shortens the chain", () => {
      // −3 days on a 4+4 finish-to-start chain overlaps them into 5 days, which
      // no longer beats the 6-day task sitting on its own.
      const durations = dur([[1, 4], [2, 4], [3, 6]]);
      const cp = criticalPath(durations, [
        edge(2, 1, { type: "FS", lagDays: -3 }),
      ]);
      expect([...cp.nodes]).toEqual([3]);
    });

    it("lets a finish-to-finish link pull its dependent's start earlier", () => {
      // 2 must merely FINISH with 1, and 2 is the longer task, so it starts
      // before 1 does. A duration-sum reading would have stacked them.
      const durations = dur([[1, 3], [2, 8]]);
      const cp = criticalPath(durations, [edge(2, 1, FF())]);
      // The pair spans 8 days, not 11: task 2 alone sets the project's length.
      expect(cp.nodes.has(2)).toBe(true);
    });

    it("keeps an edge off the path when the link leaves it slack", () => {
      // 3 is FF-linked to 1 but is long enough to have started before 1 ended,
      // so the edge is not tight: a day's slip on 1 does not move 3.
      const durations = dur([[1, 1], [2, 9], [3, 9]]);
      const cp = criticalPath(durations, [edge(2, 1), edge(3, 1, FF(0))]);
      expect(cp.edges.has(edgeKey(1, 3))).toBe(false);
    });
  });
});
