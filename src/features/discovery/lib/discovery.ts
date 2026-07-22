import {
  IDEA_STATUSES,
  type DiscoveryOverview,
  type Feedback,
  type Idea,
  type IdeaSignal,
  type IdeaStatus,
} from "../types";

/**
 * Product discovery scoring (043), split from the DB read so it is unit-testable.
 *
 * RICE = Reach × Impact × (Confidence / 100) / Effort — the classic
 * prioritisation formula, derived here rather than stored (priority_score's
 * derive-don't-store rule), so re-weighting never means a migration. Effort is
 * CHECK-bounded to >= 1 in the schema, but the guard here keeps the pure
 * function total for any caller.
 */
export function riceScore(input: {
  reach: number;
  impact: number;
  confidence: number;
  effort: number;
}): number {
  if (input.effort <= 0) return 0;
  const raw =
    (input.reach * input.impact * (input.confidence / 100)) / input.effort;
  return Math.round(raw * 10) / 10;
}

/**
 * Groups a board's feedback under the ideas it argues for and ranks the idea
 * backlog. Each idea gets its derived RICE score and its accumulated demand (how
 * much feedback, how many votes). Ideas are ordered by pipeline stage first
 * (exploring before archived) then by RICE descending — the highest-value
 * candidate at the top of its stage — with id as the stable tiebreak.
 *
 * statusCounts always names every stage (a 0 for an empty one), so the pipeline
 * header reads the same whether or not a stage holds ideas. Feedback is returned
 * as given (the caller orders it newest-first in SQL); unlinkedFeedback is the
 * depth of the unsorted inbox.
 */
export function buildDiscoveryOverview(
  ideas: Idea[],
  feedback: Feedback[]
): DiscoveryOverview {
  const demandByIdea = new Map<number, { count: number; votes: number }>();
  let unlinked = 0;
  for (const f of feedback) {
    if (f.ideaId === null) {
      unlinked += 1;
      continue;
    }
    const acc = demandByIdea.get(f.ideaId) ?? { count: 0, votes: 0 };
    acc.count += 1;
    acc.votes += f.votes;
    demandByIdea.set(f.ideaId, acc);
  }

  const stageRank = new Map<IdeaStatus, number>(
    IDEA_STATUSES.map((s, i) => [s, i])
  );

  const signals: IdeaSignal[] = ideas
    .map((idea) => {
      const d = demandByIdea.get(idea.id);
      return {
        ...idea,
        rice: riceScore(idea),
        feedbackCount: d?.count ?? 0,
        demand: d?.votes ?? 0,
      };
    })
    .sort(
      (a, b) =>
        (stageRank.get(a.status)! - stageRank.get(b.status)!) ||
        b.rice - a.rice ||
        a.id - b.id
    );

  const statusCounts = Object.fromEntries(
    IDEA_STATUSES.map((s) => [s, 0])
  ) as Record<IdeaStatus, number>;
  for (const idea of ideas) statusCounts[idea.status] += 1;

  return { ideas: signals, statusCounts, feedback, unlinkedFeedback: unlinked };
}

/**
 * Compiles the task description a promoted idea carries into delivery (043),
 * split out so the shape is unit-testable (compileSubmission's twin, 039). The
 * idea's own detail leads; a discovery footer records the RICE score and the
 * demand that justified the promotion, so the delivery record remembers why the
 * work was committed. An idea with no detail and no demand promotes to a bare
 * title — the footer only appears when there is something to say.
 */
export function compilePromotion(
  idea: { description: string },
  signal: { rice: number; feedbackCount: number; demand: number }
): string {
  const parts: string[] = [];
  const detail = idea.description.trim();
  if (detail) parts.push(detail);

  const footer: string[] = [`**Promoted from discovery** — RICE ${signal.rice}`];
  if (signal.feedbackCount > 0) {
    footer.push(
      `${signal.feedbackCount} piece${signal.feedbackCount === 1 ? "" : "s"} of feedback, ${signal.demand} vote${signal.demand === 1 ? "" : "s"}`
    );
  }
  parts.push(footer.join(" · "));

  return parts.join("\n\n");
}
