import { describe, expect, it } from "vitest";

import { buildScaledAgile } from "./scaledAgile";
import type { SafBoard, TeamWithMembers } from "../types";

function board(over: Partial<SafBoard> & { id: number }): SafBoard {
  return {
    name: `Board ${over.id}`,
    total: 0,
    done: 0,
    hasDoneColumn: true,
    milestones: 0,
    overdue: 0,
    programId: null,
    teamId: null,
    teamName: null,
    ...over,
  };
}

describe("buildScaledAgile", () => {
  it("groups boards under their ART, names before Unassigned, and rolls up", () => {
    const arts = [
      { id: 2, name: "Platform" },
      { id: 1, name: "Mobile" },
    ];
    const boards = [
      board({ id: 10, programId: 1, teamId: 5, teamName: "Alpha", total: 4, done: 1, overdue: 1 }),
      board({ id: 11, programId: 2, total: 2, done: 2 }),
      board({ id: 12, programId: null, total: 3, done: 0, overdue: 2 }), // unassigned ART
    ];
    const o = buildScaledAgile(arts, boards, [], []);

    // ARTs in name order (Mobile, Platform), Unassigned last.
    expect(o.arts.map((g) => g.art?.name ?? "—")).toEqual(["Mobile", "Platform", "—"]);

    const mobile = o.arts[0];
    expect(mobile.boards[0].teamName).toBe("Alpha");
    expect(mobile.totals).toEqual({ boards: 1, total: 4, done: 1, overdue: 1 });

    // Portfolio (top layer) totals are the sum across every board.
    expect(o.portfolio.totals).toEqual({ boards: 3, total: 9, done: 3, overdue: 3 });
  });

  it("omits the Unassigned ART when every board files under one", () => {
    const o = buildScaledAgile(
      [{ id: 1, name: "Only" }],
      [board({ id: 10, programId: 1 })],
      [],
      []
    );
    expect(o.arts).toHaveLength(1);
    expect(o.arts[0].art?.name).toBe("Only");
  });

  it("passes the team roster and workspace members through", () => {
    const teams: TeamWithMembers[] = [
      {
        id: 5,
        workspaceId: "w",
        name: "Alpha",
        createdAt: "2026-07-22T00:00:00Z",
        members: [{ userId: "u1", name: "Ada" }],
      },
    ];
    const members = [
      { userId: "u1", name: "Ada" },
      { userId: "u2", name: "Bo" },
    ];
    const o = buildScaledAgile([], [], teams, members);
    expect(o.teams).toEqual(teams);
    expect(o.members).toEqual(members);
    expect(o.arts).toEqual([]);
  });
});
