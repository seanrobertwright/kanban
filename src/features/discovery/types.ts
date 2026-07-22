/**
 * Product discovery + Feedback intake (043) — two capability rows on one model.
 * An Idea is a candidate for future work moving through a discovery pipeline;
 * Feedback is the customer/stakeholder signal that argues for ideas. A validated
 * idea is promoted into a real task (createTask), carrying its accumulated demand.
 */

export type IdeaStatus =
  | "exploring"
  | "validating"
  | "validated"
  | "promoted"
  | "archived";

/** Pipeline order — the discovery lifecycle, and the order the overview groups by. */
export const IDEA_STATUSES: IdeaStatus[] = [
  "exploring",
  "validating",
  "validated",
  "promoted",
  "archived",
];

export function isIdeaStatus(v: unknown): v is IdeaStatus {
  return typeof v === "string" && (IDEA_STATUSES as string[]).includes(v);
}

export type FeedbackSentiment = "praise" | "problem" | "idea" | "question";

export const FEEDBACK_SENTIMENTS: FeedbackSentiment[] = [
  "praise",
  "problem",
  "idea",
  "question",
];

export function isFeedbackSentiment(v: unknown): v is FeedbackSentiment {
  return typeof v === "string" && (FEEDBACK_SENTIMENTS as string[]).includes(v);
}

/** An idea as stored. RICE score is derived, not a column (see lib/discovery.ts). */
export interface Idea {
  id: number;
  boardId: number;
  title: string;
  description: string;
  status: IdeaStatus;
  /** People/accounts affected per period. */
  reach: number;
  /** Impact on a 1..5 massive..minimal scale. */
  impact: number;
  /** Confidence as a percent, 0..100. */
  confidence: number;
  /** Effort in person-weeks, >= 1. */
  effort: number;
  /** The task this idea became, once promoted; null otherwise. */
  promotedTaskId: number | null;
  createdAt: string;
}

/** A piece of feedback as stored — a raw demand signal, optionally filed under an idea. */
export interface Feedback {
  id: number;
  boardId: number;
  /** The idea it argues for, or null for the unsorted inbox. */
  ideaId: number | null;
  body: string;
  source: string;
  sentiment: FeedbackSentiment;
  votes: number;
  createdAt: string;
}

/** An idea enriched with its derived RICE score and the demand attached to it. */
export interface IdeaSignal extends Idea {
  /** Reach × Impact × (Confidence/100) / Effort, rounded to one decimal. */
  rice: number;
  /** How many pieces of feedback are filed under this idea. */
  feedbackCount: number;
  /** The sum of those pieces' votes — the idea's total demand. */
  demand: number;
}

/** A board's whole discovery picture: the ranked idea backlog, the pipeline
 *  counts, and the feedback inbox (all of it, plus how much is still unfiled). */
export interface DiscoveryOverview {
  ideas: IdeaSignal[];
  statusCounts: Record<IdeaStatus, number>;
  feedback: Feedback[];
  /** Feedback not yet filed under any idea — the triage inbox depth. */
  unlinkedFeedback: number;
}

export interface CreateIdeaInput {
  title: string;
  description?: string;
  reach?: number;
  impact?: number;
  confidence?: number;
  effort?: number;
}

export interface UpdateIdeaInput {
  title?: string;
  description?: string;
  status?: IdeaStatus;
  reach?: number;
  impact?: number;
  confidence?: number;
  effort?: number;
}

export interface CreateFeedbackInput {
  body: string;
  source?: string;
  sentiment?: FeedbackSentiment;
  /** File it under an idea straight away, or leave it in the inbox (absent/null). */
  ideaId?: number | null;
}

export interface UpdateFeedbackInput {
  /** Three-valued: absent leaves the filing, number re-files, null returns to inbox. */
  ideaId?: number | null;
  /** An upvote — bumps votes by one when true. */
  vote?: boolean;
}

export const IDEA_TITLE_MAX = 140;
export const FEEDBACK_BODY_MAX = 2000;
export const FEEDBACK_SOURCE_MAX = 80;
/** A reach above this is a data-entry slip, not a plan. */
export const REACH_MAX = 10_000_000;
/** Effort in person-weeks; a year-plus is out of discovery's horizon. */
export const EFFORT_MAX = 520;
