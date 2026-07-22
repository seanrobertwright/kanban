import type { PortfolioBoard } from "@/features/workspaces/types";
import { summarizePortfolio } from "@/features/workspaces/lib/portfolio";
import type {
  ArtGroup,
  ScaledAgileOverview,
  SafBoard,
  TeamMemberRef,
  TeamWithMembers,
} from "../types";

/**
 * Composes the Scaled Agile / SAFe layer cake (044), split from the DB read so
 * the shape is unit-testable.
 *
 * Boards are grouped under their ART (program, 040) exactly the way
 * buildProgramsOverview groups them — real ARTs first in name order, the null
 * "Unassigned" pseudo-ART last and only when it holds boards — with each board
 * already carrying the team that owns it. Each ART's totals and the top-layer
 * portfolio totals are the portfolio rollup (summarizePortfolio), so a program's
 * numbers are the sum of its projects' and the workspace's are the sum of all —
 * which is exactly what the hierarchy promises at each layer up.
 */
export function buildScaledAgile(
  arts: { id: number; name: string }[],
  boards: SafBoard[],
  teams: TeamWithMembers[],
  members: TeamMemberRef[]
): ScaledAgileOverview {
  const byArt = new Map<number, SafBoard[]>();
  const unassigned: SafBoard[] = [];
  for (const board of boards) {
    if (board.programId === null) {
      unassigned.push(board);
    } else {
      const list = byArt.get(board.programId) ?? [];
      list.push(board);
      byArt.set(board.programId, list);
    }
  }

  // summarizePortfolio wants plain PortfolioBoard rows; SafBoard is a superset,
  // so its rows satisfy the rollup's reduce as-is.
  const rollup = (rows: PortfolioBoard[]) => summarizePortfolio(rows).totals;

  const sorted = [...arts].sort(
    (a, b) => a.name.localeCompare(b.name) || a.id - b.id
  );
  const groups: ArtGroup[] = sorted.map((art) => {
    const groupBoards = byArt.get(art.id) ?? [];
    return { art, boards: groupBoards, totals: rollup(groupBoards) };
  });

  if (unassigned.length > 0) {
    groups.push({ art: null, boards: unassigned, totals: rollup(unassigned) });
  }

  return {
    portfolio: { totals: rollup(boards) },
    arts: groups,
    teams,
    members,
  };
}
