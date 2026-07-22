import type { PortfolioBoard } from "@/features/workspaces/types";
import { summarizePortfolio } from "@/features/workspaces/lib/portfolio";
import type { Program, ProgramGroup, ProgramsOverview } from "../types";

/** A portfolio board row carrying which program (if any) it files under. */
export type BoardWithProgram = PortfolioBoard & { programId: number | null };

/**
 * Groups a workspace's boards under their programs (040), split from the DB read
 * so the shape is unit-testable. Every program appears — even one with no boards,
 * so an admin can see an empty initiative to assign into — in name order; the
 * null "Unassigned" bucket comes last and only when it holds boards. Each group's
 * totals are the portfolio rollup over its own boards (summarizePortfolio), so a
 * program's numbers are the sum of its projects' — exactly what the hierarchy
 * promises one level up.
 */
export function buildProgramsOverview(
  programs: Program[],
  boards: BoardWithProgram[]
): ProgramsOverview {
  const byProgram = new Map<number, PortfolioBoard[]>();
  const unassigned: PortfolioBoard[] = [];
  for (const board of boards) {
    // Strip the grouping key back off — a group's boards are plain PortfolioBoard.
    const { programId, ...row } = board;
    if (programId === null) {
      unassigned.push(row);
    } else {
      const list = byProgram.get(programId) ?? [];
      list.push(row);
      byProgram.set(programId, list);
    }
  }

  const sorted = [...programs].sort((a, b) =>
    a.name.localeCompare(b.name) || a.id - b.id
  );
  const groups: ProgramGroup[] = sorted.map((program) => {
    const groupBoards = byProgram.get(program.id) ?? [];
    return { program, boards: groupBoards, totals: summarizePortfolio(groupBoards).totals };
  });

  if (unassigned.length > 0) {
    groups.push({
      program: null,
      boards: unassigned,
      totals: summarizePortfolio(unassigned).totals,
    });
  }

  return { groups };
}
