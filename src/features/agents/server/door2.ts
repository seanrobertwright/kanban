import type { Principal } from "@/features/auth/server/principal";
import { externalAgentAction, type ExternalOutcome } from "./gate";

/**
 * §7.4's approval model as it looks over HTTP — Door 2, the external-agent door.
 *
 * The native runtime threads every mutating tool call through gate.ts. Door 2's
 * mutations arrive as plain HTTP handled by the same feature handlers a human's
 * browser hits, so each of those handlers needs the same gate. This module is
 * the one place that shape lives: two response bodies, and one wrapper that
 * turns an ExternalOutcome into the answer to send.
 *
 * Keeping it here rather than in each slice matters because the tier vocabulary
 * is one vocabulary — a tool named in DEFAULT_TIER, a policy override read from
 * the agent row, one 202 body the agent's client learns to recognise once.
 */

/** A changeset-tier action: understood, recorded as a proposal, NOT applied. 202
 *  because the request was accepted for processing and a human completes it. */
export function heldForReview(
  held: { runId: string; changesetId: string },
  extra?: Record<string, unknown>
) {
  return Response.json(
    {
      code: "HELD_FOR_REVIEW",
      heldForReview: true,
      runId: held.runId,
      changesetId: held.changesetId,
      message:
        "This change is consequential for an agent, so it was recorded as a proposal " +
        "instead of applied. A human will accept or reject it; do not retry it.",
      ...extra,
    },
    { status: 202 }
  );
}

/** A block-tier action. 403 with a code the agent can tell apart from a role
 *  failure: retrying with the same key will never work, and a different key is
 *  not the answer either — a human has to do this one. */
export function blockedByPolicy(tool: string) {
  return Response.json(
    {
      code: "BLOCKED_BY_POLICY",
      error: `"${tool}" requires explicit human approval for this agent and was not performed.`,
    },
    { status: 403 }
  );
}

/** The HTTP answer for a refused outcome, or null when the action ran and the
 *  handler should shape its own success response. */
export function door2Response(outcome: ExternalOutcome<unknown>): Response | null {
  if (outcome.kind === "blocked") return blockedByPolicy(outcome.tool);
  if (outcome.kind === "held") return heldForReview(outcome);
  return null;
}

/**
 * The whole Door-2 gate for one handler: humans execute directly, agents go
 * through the tier machinery, and either way the caller says how a success is
 * shaped. Handlers keep their own try/catch — an authz failure is still
 * authzErrorResponse's to answer, not the gate's.
 *
 * The `principal.kind` split lives here rather than in every handler because
 * getting it wrong is silent: forgetting the check does not fail a type or a
 * test, it just means one more endpoint an agent walks through ungated.
 */
export async function gated<T>(
  principal: Principal,
  spec: {
    tool: string;
    input: unknown;
    taskId: number | null;
    anchorTaskId?: number | null;
    authorize?: () => Promise<void>;
    execute: () => Promise<T>;
  },
  respond: (result: T) => Response
): Promise<Response> {
  if (principal.kind !== "agent") return respond(await spec.execute());
  const outcome = await externalAgentAction(principal, spec);
  return door2Response(outcome) ?? respond((outcome as { result: T }).result);
}
