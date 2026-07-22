import { createHmac, timingSafeEqual } from "node:crypto";

import type { GitAction } from "@/features/activity/types";
import type { GitLinkState, NormalizedGitEvent } from "../types";

/**
 * Bitbucket adapter (2.3) — the third vendor half of the git spine (2.0), the
 * sibling of the GitHub (2.1) and GitLab (2.2) adapters. Same two provider-specific
 * jobs: verify the webhook, and map Bitbucket's payloads onto the
 * provider-agnostic NormalizedGitEvent. Everything downstream is 2.0's, shared.
 *
 * Where GitHub and GitLab bracket the verification spectrum, Bitbucket sits with
 * GitHub: a configured webhook secret makes Bitbucket sign the raw body
 * HMAC-SHA256 and send it as `X-Hub-Signature: sha256=<hex>` — the same scheme as
 * GitHub, minus the `-256` header suffix. The event type rides `X-Event-Key`
 * (`repo:push`, `pullrequest:created|updated|fulfilled|rejected`), not the body.
 *
 * The OAuth/Connect install and the REST calls against the live API (branch
 * creation 2.6, pipeline/CI 2.7) are the remaining vendor surface, exercised
 * against the live API. The webhook-receiving contract below is the testable core.
 */

/**
 * Verifies Bitbucket's `X-Hub-Signature` over the exact request body, using the
 * connection's secret. Bitbucket sends `sha256=<hex hmac>` (the GitHub scheme
 * under a different header name); we recompute and compare in constant time. A
 * missing or wrong-length header fails closed before the compare.
 *
 * The body MUST be the raw bytes Bitbucket sent — verify before JSON.parse — since
 * a re-encoded body would not reproduce the same HMAC.
 */
export function verifyBitbucketSignature(
  secret: string,
  body: string,
  header: string | null
): boolean {
  if (!header) return false;
  const expected = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
  const got = Buffer.from(header);
  const want = Buffer.from(expected);
  if (got.length !== want.length) return false;
  return timingSafeEqual(got, want);
}

// Bitbucket's webhook payloads, narrowed to the fields the adapter reads. Loose by
// design — a payload is untrusted external JSON, so every access is guarded.
interface BitbucketPayload {
  repository?: { links?: { html?: { href?: string } } };
  pullrequest?: {
    id?: number;
    title?: string;
    description?: string;
    state?: string;
    links?: { html?: { href?: string } };
    source?: { branch?: { name?: string } };
  };
  push?: {
    changes?: Array<{
      old?: unknown;
      new?: { type?: string; name?: string } | null;
      commits?: Array<{
        hash?: string;
        message?: string;
        links?: { html?: { href?: string } };
      }>;
    }>;
  };
}

/**
 * Maps a Bitbucket webhook (its `X-Event-Key` + parsed payload) to zero or more
 * normalized events. Zero for events we do not model; one for a pull request; N
 * for a push (one per commit across all changes, plus a branch link for each
 * newly created branch). The ingress dedupes redundant deliveries by state, so
 * emitting a PR's current state on every update is safe.
 */
export function normalizeBitbucketEvent(
  eventKey: string,
  payload: BitbucketPayload
): NormalizedGitEvent[] {
  if (eventKey.startsWith("pullrequest:")) return pullRequestEvent(payload);
  if (eventKey === "repo:push") return pushEvents(payload);
  return [];
}

function pullRequestEvent(payload: BitbucketPayload): NormalizedGitEvent[] {
  const pr = payload.pullrequest;
  const url = pr?.links?.html?.href;
  if (!pr || typeof pr.id !== "number" || !url) return [];

  let state: GitLinkState;
  let action: GitAction;
  if (pr.state === "MERGED") {
    state = "merged";
    action = "git.pr_merged";
  } else if (pr.state === "DECLINED" || pr.state === "SUPERSEDED") {
    state = "closed";
    action = "git.pr_closed";
  } else {
    // OPEN (and any non-terminal state) reads as open.
    state = "open";
    action = "git.pr_opened";
  }

  return [
    {
      provider: "bitbucket",
      kind: "pr",
      externalId: String(pr.id),
      url,
      state,
      title: pr.title ?? null,
      action,
      branch: pr.source?.branch?.name,
      messages: [pr.title, pr.description].filter(
        (s): s is string => Boolean(s)
      ),
    },
  ];
}

function pushEvents(payload: BitbucketPayload): NormalizedGitEvent[] {
  const changes = Array.isArray(payload.push?.changes) ? payload.push!.changes : [];
  const repoHtml = payload.repository?.links?.html?.href;
  const events: NormalizedGitEvent[] = [];

  for (const change of changes) {
    if (!change) continue;
    const branch =
      change.new?.type === "branch" ? change.new.name : undefined;

    // A newly created branch (no `old`) mirrors GitHub's `create` event: one
    // branch link so a `feature/123-slug` branch tracks its task before any commit
    // is referenced. Idempotent — a push to an existing branch carries `old`.
    if (branch && change.old == null) {
      events.push({
        provider: "bitbucket",
        kind: "branch",
        externalId: branch,
        url: repoHtml ? `${repoHtml}/branch/${branch}` : "",
        state: null,
        title: null,
        action: "git.branch_linked",
        branch,
        messages: [],
      });
    }

    const commits = Array.isArray(change.commits) ? change.commits : [];
    for (const c of commits) {
      const url = c?.links?.html?.href;
      if (!c || typeof c.hash !== "string" || !url) continue;
      events.push({
        provider: "bitbucket",
        kind: "commit",
        externalId: c.hash,
        url,
        state: null,
        title: c.message ? c.message.split("\n")[0] : null,
        action: "git.commit_linked",
        branch,
        messages: c.message ? [c.message] : [],
      });
    }
  }
  return events;
}
