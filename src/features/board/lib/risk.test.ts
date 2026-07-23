import { describe, expect, it } from "vitest";
import { assessRisk } from "./risk";

describe("assessRisk", () => {
  it("ranks explainable overdue and blocked work ahead of aging work", () => {
    const risks = assessRisk([
      { id: 1, title: "Late", dueDate: "2026-07-01", blockedByCount: 1, ageDays: 20, inDoneColumn: false },
      { id: 2, title: "Aging", dueDate: null, blockedByCount: 0, ageDays: 8, inDoneColumn: false },
      { id: 3, title: "Done", dueDate: "2026-07-01", blockedByCount: 1, ageDays: 20, inDoneColumn: true },
    ], "2026-07-23");
    expect(risks).toHaveLength(2);
    expect(risks[0]).toMatchObject({ taskId: 1, level: "high", score: 0.9 });
    expect(risks[0].reasons).toContain("overdue since 2026-07-01");
    expect(risks[1]).toMatchObject({ taskId: 2, level: "low", score: 0.1 });
  });
});
