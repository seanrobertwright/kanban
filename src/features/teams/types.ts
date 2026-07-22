import type { PortfolioBoard } from "@/features/workspaces/types";

/**
 * Teams + Scaled Agile / SAFe (044). A Team is the workspace-level group of
 * people SAFe's layer cake is built from: Portfolio → Program(ART) → Team →
 * Board → work. This feature adds the Team layer and composes the whole cake
 * into one view, reusing the portfolio rollup (workspaces) and the program
 * grouping (040) rather than re-modelling them.
 */

export interface Team {
  id: number;
  workspaceId: string;
  name: string;
  createdAt: string;
}

/** One person on a team's roster. */
export interface TeamMemberRef {
  userId: string;
  name: string;
}

export interface TeamWithMembers extends Team {
  members: TeamMemberRef[];
}

/** A board's line in the Scaled Agile view: the portfolio rollup plus which ART
 *  (program) it files under and which team owns it. */
export interface SafBoard extends PortfolioBoard {
  programId: number | null;
  teamId: number | null;
  teamName: string | null;
}

/** An ART (a program, 040) with the boards delivering under it and their rollup.
 *  The null program is the pseudo-ART of boards not filed under any program. */
export interface ArtGroup {
  art: { id: number; name: string } | null;
  boards: SafBoard[];
  totals: { boards: number; total: number; done: number; overdue: number };
}

/** The workspace read as a SAFe layer cake. `portfolio` is the top-layer totals,
 *  `arts` the program/ART layer with their boards+teams, `teams` the team roster.
 *  `members` is the workspace's people, for the roster-assignment pickers. */
export interface ScaledAgileOverview {
  portfolio: { totals: { boards: number; total: number; done: number; overdue: number } };
  arts: ArtGroup[];
  teams: TeamWithMembers[];
  members: TeamMemberRef[];
}

export interface CreateTeamInput {
  name: string;
}

export interface UpdateTeamInput {
  name?: string;
}

export const TEAM_NAME_MAX = 80;
