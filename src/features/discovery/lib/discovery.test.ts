import { describe, expect, it } from "vitest";

import {
  buildDiscoveryOverview,
  compilePromotion,
  riceScore,
} from "./discovery";
import type { Feedback, Idea } from "../types";

function idea(over: Partial<Idea> & { id: number }): Idea {
  return {
    boardId: 1,
    title: `Idea ${over.id}`,
    description: "",
    status: "exploring",
    reach: 0,
    impact: 1,
    confidence: 100,
    effort: 1,
    promotedTaskId: null,
    createdAt: "2026-07-22T00:00:00Z",
    ...over,
  };
}

function feedback(over: Partial<Feedback> & { id: number }): Feedback {
  return {
    boardId: 1,
    ideaId: null,
    body: `Feedback ${over.id}`,
    source: "",
    sentiment: "idea",
    votes: 1,
    createdAt: "2026-07-22T00:00:00Z",
    ...over,
  };
}

describe("riceScore", () => {
  it("computes Reach × Impact × (Confidence/100) / Effort", () => {
    // 1000 × 3 × 0.8 / 4 = 600
    expect(riceScore({ reach: 1000, impact: 3, confidence: 80, effort: 4 })).toBe(600);
  });

  it("rounds to one decimal", () => {
    // 10 × 1 × 1 / 3 = 3.333… → 3.3
    expect(riceScore({ reach: 10, impact: 1, confidence: 100, effort: 3 })).toBe(3.3);
  });

  it("is a total function — zero effort yields 0, not Infinity", () => {
    expect(riceScore({ reach: 10, impact: 3, confidence: 100, effort: 0 })).toBe(0);
  });

  it("reads 0 for a fresh idea (reach 0)", () => {
    expect(riceScore({ reach: 0, impact: 1, confidence: 100, effort: 1 })).toBe(0);
  });
});

describe("buildDiscoveryOverview", () => {
  it("attaches feedback demand and ranks by stage then RICE", () => {
    const ideas = [
      idea({ id: 1, status: "validating", reach: 100, impact: 2, confidence: 100, effort: 1 }), // rice 200
      idea({ id: 2, status: "exploring", reach: 100, impact: 1, confidence: 100, effort: 1 }), // rice 100
      idea({ id: 3, status: "exploring", reach: 100, impact: 3, confidence: 100, effort: 1 }), // rice 300
    ];
    const fb = [
      feedback({ id: 10, ideaId: 3, votes: 5 }),
      feedback({ id: 11, ideaId: 3, votes: 2 }),
      feedback({ id: 12, ideaId: null }),
    ];
    const o = buildDiscoveryOverview(ideas, fb);

    // exploring (rank 0) before validating (rank 1); within exploring, higher RICE first.
    expect(o.ideas.map((i) => i.id)).toEqual([3, 2, 1]);
    const three = o.ideas.find((i) => i.id === 3)!;
    expect(three.rice).toBe(300);
    expect(three.feedbackCount).toBe(2);
    expect(three.demand).toBe(7);
  });

  it("names every stage in statusCounts and counts the inbox", () => {
    const o = buildDiscoveryOverview(
      [idea({ id: 1, status: "archived" }), idea({ id: 2, status: "exploring" })],
      [feedback({ id: 10, ideaId: null }), feedback({ id: 11, ideaId: 1 })]
    );
    expect(o.statusCounts).toEqual({
      exploring: 1,
      validating: 0,
      validated: 0,
      promoted: 0,
      archived: 1,
    });
    expect(o.unlinkedFeedback).toBe(1);
  });
});

describe("compilePromotion", () => {
  it("leads with the idea's detail and footers RICE + demand", () => {
    const out = compilePromotion(
      { description: "Let users export to PDF" },
      { rice: 42.5, feedbackCount: 3, demand: 9 }
    );
    expect(out).toBe(
      "Let users export to PDF\n\n**Promoted from discovery** — RICE 42.5 · 3 pieces of feedback, 9 votes"
    );
  });

  it("promotes a bare idea to just the footer, and singularises", () => {
    const out = compilePromotion(
      { description: "   " },
      { rice: 1, feedbackCount: 1, demand: 1 }
    );
    expect(out).toBe("**Promoted from discovery** — RICE 1 · 1 piece of feedback, 1 vote");
  });
});
