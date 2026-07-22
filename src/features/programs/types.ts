import type { PortfolioBoard } from "@/features/workspaces/types";

/**
 * Programs / initiatives (040) — the grouping above a board. A workspace's boards
 * are its projects; a Program gathers several into an initiative so the workspace
 * reads one level up. This is the "Program/initiative hierarchy" the feature model
 * names: Program → Board(project) → Epic → Milestone → Task.
 */

export interface Program {
  id: number;
  workspaceId: string;
  name: string;
  createdAt: string;
}

/**
 * One line in the programs overview: a program (or the null "Unassigned" bucket)
 * with the boards filed under it and the rollup across them. The board rows and
 * the rollup arithmetic are the portfolio's (the program view is the portfolio
 * grouped by initiative), so PortfolioBoard is reused rather than re-modelled.
 */
export interface ProgramGroup {
  /** null is the pseudo-group of boards not filed under any program. */
  program: Program | null;
  boards: PortfolioBoard[];
  totals: {
    boards: number;
    total: number;
    done: number;
    overdue: number;
  };
}

/** The whole workspace grouped by program — real programs first (in name order),
 *  the Unassigned bucket last when it has boards. */
export interface ProgramsOverview {
  groups: ProgramGroup[];
}

export interface CreateProgramInput {
  name: string;
}

export interface UpdateProgramInput {
  name?: string;
}

export const PROGRAM_NAME_MAX = 80;
