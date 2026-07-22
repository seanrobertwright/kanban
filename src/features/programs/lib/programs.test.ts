import { describe, expect, it } from "vitest";

import type { PortfolioBoard } from "@/features/workspaces/types";
import { buildProgramsOverview, type BoardWithProgram } from "./programs";
import type { Program } from "../types";

/**
 * The grouping and rollup are pure arithmetic over the DB rows (040), so they are
 * tested without a database — the ordering (programs by name, Unassigned last),
 * the empty-program-still-shows rule, and the per-group totals.
 */

const base: Omit<PortfolioBoard, "id" | "name" | "total" | "done"> = {
  hasDoneColumn: true,
  milestones: 0,
  overdue: 0,
};

function board(
  id: number,
  name: string,
  total: number,
  done: number,
  programId: number | null
): BoardWithProgram {
  return { id, name, total, done, programId, ...base };
}

const programs: Program[] = [
  { id: 2, workspaceId: "w", name: "Mobile", createdAt: "" },
  { id: 1, workspaceId: "w", name: "Platform", createdAt: "" },
  { id: 3, workspaceId: "w", name: "Empty", createdAt: "" },
];

describe("buildProgramsOverview", () => {
  it("groups boards, orders programs by name, and sums per group", () => {
    const { groups } = buildProgramsOverview(programs, [
      board(10, "iOS", 4, 2, 2),
      board(11, "Android", 6, 3, 2),
      board(12, "API", 10, 10, 1),
      board(13, "Scratch", 3, 0, null),
    ]);

    // Empty (0 boards), Mobile, Platform, then Unassigned last.
    expect(groups.map((g) => g.program?.name ?? "Unassigned")).toEqual([
      "Empty",
      "Mobile",
      "Platform",
      "Unassigned",
    ]);

    const mobile = groups.find((g) => g.program?.name === "Mobile")!;
    expect(mobile.boards).toHaveLength(2);
    expect(mobile.totals).toEqual({ boards: 2, total: 10, done: 5, overdue: 0 });

    const empty = groups.find((g) => g.program?.name === "Empty")!;
    expect(empty.boards).toHaveLength(0);
    expect(empty.totals.total).toBe(0);
  });

  it("omits the Unassigned bucket when every board is filed", () => {
    const { groups } = buildProgramsOverview([programs[0]], [
      board(10, "iOS", 1, 0, 2),
    ]);
    expect(groups.some((g) => g.program === null)).toBe(false);
  });

  it("strips the grouping key off the board rows", () => {
    const { groups } = buildProgramsOverview([programs[1]], [
      board(12, "API", 1, 1, 1),
    ]);
    expect("programId" in groups[0].boards[0]).toBe(false);
  });
});
