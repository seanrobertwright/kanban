/**
 * Reading a claim's lease (076) — pure, so the card, the list and any future
 * reader answer "is this hold still real?" the same way.
 *
 * The lease was built to stop a crashed agent wedging a task forever, and
 * claimTask enforces it under a row lock with the database's own `now()`. What
 * was missing is the other half: every *reader* saw `claimedBy` set and had no
 * way to tell a live hold from one that lapsed two days ago, so the task stayed
 * wedged in the only place that decides whether anyone picks it up — a person
 * scanning a column, or an agent scanning `list_board` for something to work.
 *
 * These functions are a display hint, not the gate. The authority is the server:
 * a takeover is refused or allowed inside claimTask's transaction, against the
 * database clock. A client's clock can be wrong, so a card may say "lapsed" a
 * few seconds early or late — which costs a refused claim at worst, and never
 * grants one, because nothing here is asked before a write.
 */
import type { Task } from "../types";

/** The lease-carrying half of a task — everything here needs these two fields
 *  and nothing else, so a caller holding a snapshot can ask too. */
export type ClaimView = Pick<Task, "claimedBy" | "claimExpiresAt">;

/**
 * Whether a hold has run out.
 *
 * A null expiry never lapses, which is 076's rule rather than a missing case: a
 * claim taken before the lease existed means "held until released", and reading
 * it as expired would silently free every hold in the wild the day the migration
 * ran. An unclaimed task is not lapsed either — there is no hold to have ended.
 */
export function claimLapsed(task: ClaimView, now: number = Date.now()): boolean {
  if (!task.claimedBy || !task.claimExpiresAt) return false;
  return new Date(task.claimExpiresAt).getTime() < now;
}

/**
 * What the hold mark says, for a title attribute and its screen-reader twin.
 *
 * A lapsed hold keeps naming its holder rather than reading as free: "an agent
 * was working on this and its lease ran out" is what a reader needs to decide
 * whether to pick the work up, and "unclaimed" throws that away. Only humans are
 * in a client-side roster today, so an agent stays generic (claimedBy's rule).
 */
export function holdLabel(task: ClaimView, now: number = Date.now()): string {
  if (!task.claimedBy) return "";
  const who = task.claimedBy.type === "agent" ? "An agent" : "Someone";
  return claimLapsed(task, now)
    ? `${who} held this and the claim has lapsed — it is free to take`
    : task.claimedBy.type === "agent"
      ? "An agent is working on this"
      : "Being worked on";
}
