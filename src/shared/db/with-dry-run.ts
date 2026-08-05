import { getPrincipalFromRequest } from "@/features/auth/server/agent-auth";
import { asPrincipal } from "@/features/auth/server/principal";
import {
  DRY_RUN_HEADER,
  DryRunViolation,
  dryRunBody,
  runAsDryRun,
} from "./dry-run";

/**
 * The route boundary for a dry run (§4.4 item 9) — the header, the principal
 * check, and the answer. The mechanism itself is in `dry-run.ts`, which imports
 * nothing so the pool can call its guard without importing the auth layer back.
 *
 * Wrapped at the route rather than inside each handler, exactly like
 * `withIdempotency` and for the same reason: the handler keeps its own body
 * parsing and its own 401, and the diff that makes an endpoint dry-runnable is
 * one line in its route file. Both costs — the header read, the second principal
 * resolution — are paid only when the header is present.
 */

const refuse = (error: string, code: string, status = 400) =>
  Response.json({ error, code }, { status });

export async function withDryRun(
  request: Request,
  work: () => Promise<Response>
): Promise<Response> {
  const header = request.headers.get(DRY_RUN_HEADER);
  if (header === null) return work();

  const asked = header.trim().toLowerCase();
  // `false` means what the word means: do it. Anything else is a 400 rather
  // than a guess, because guessing "flase" means no is how a caller that meant
  // to ask ends up having mutated the board instead.
  if (asked === "false" || asked === "0") return work();
  if (asked !== "true" && asked !== "1") {
    return refuse(`${DRY_RUN_HEADER} must be true or false`, "INVALID_DRY_RUN");
  }

  const principal = await getPrincipalFromRequest(request);
  // No principal is the handler's 401 to answer, as in withIdempotency:
  // answering it from two places would let them disagree.
  if (!principal) return work();
  if (asPrincipal(principal).kind !== "agent") {
    return refuse(
      "Dry-Run is available to agent principals only",
      "DRY_RUN_AGENT_ONLY",
      403
    );
  }

  let planned: { response: Response; plans: Awaited<ReturnType<typeof runAsDryRun>>["plans"] };
  try {
    planned = await runAsDryRun(work);
  } catch (error) {
    // A write the guard stopped: this endpoint reached a mutation without
    // planning it, so it has no dry run. Nothing was applied, which is the only
    // part of the promise that had to survive.
    if (error instanceof DryRunViolation) {
      return Response.json(
        { error: error.message, code: "DRY_RUN_UNSUPPORTED", dryRun: true },
        { status: 501 }
      );
    }
    throw error;
  }

  // A refusal outranks a plan. A handler can plan one action and then reject the
  // request — a PATCH whose move is legal and whose title is empty — and
  // answering with the plan would report a call that would never have run. An
  // empty plan list means the handler answered before reaching a gate at all.
  if (planned.plans.length === 0 || !planned.response.ok) return planned.response;
  return dryRunBody(planned.plans);
}
