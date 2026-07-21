import { describe, expect, it } from "vitest";

import type { TaskDependencyEdge } from "@/features/dependencies/types";
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
  const edge = (taskId: number, dependsOnId: number): TaskDependencyEdge => ({
    taskId,
    dependsOnId,
  });

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
});
