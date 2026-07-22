import { timingSafeEqual } from "node:crypto";

import type { GitAction } from "@/features/activity/types";
import type { GitLinkState, NormalizedGitEvent } from "../types";

/**
 * GitLab adapter (2.2) — the second vendor half of the git spine (2.0), the twin
 * of the GitHub adapter (2.1). Same two provider-specific jobs and nothing else:
 * verify GitLab's webhook credential, and map GitLab's payloads onto the
 * provider-agnostic NormalizedGitEvent the ingress consumes. Everything downstream
 * (task resolution, link upsert, idempotency, rule firing) is 2.0's, shared with
 * GitHub/Bitbucket.
 *
 * The one shape difference from GitHub worth stating: GitLab does not HMAC the
 * body. A webhook carries a plain secret token in `X-Gitlab-Token`, which the
 * project's webhook config was given at connect time — so verification is a
 * constant-time equality of that token against the connection's stored secret, not
 * a signature over the bytes. The body can therefore be read after verifying (no
 * raw-body-before-parse constraint like GitHub's).
 *
 * The OAuth application handshake and the REST calls against the live API (branch
 * creation 2.6, pipeline/CI backfill 2.7) are the remaining vendor surface; they
 * need real app credentials and run against the live API, not here. The
 * webhook-receiving contract below is the testable core.
 */

/**
 * Verifies GitLab's `X-Gitlab-Token` against the connection's secret in constant
 * time. GitLab sends the token verbatim (no HMAC), so this is a length-checked
 * `timingSafeEqual` — a missing header or a length mismatch fails closed before
 * the compare, since timingSafeEqual throws on unequal-length buffers.
 */
export function verifyGitlabToken(
  secret: string,
  header: string | null
): boolean {
  if (!header) return false;
  const got = Buffer.from(header);
  const want = Buffer.from(secret);
  if (got.length !== want.length) return false;
  return timingSafeEqual(got, want);
}

// GitLab's webhook payloads, narrowed to the fields the adapter reads. Loose by
// design — a payload is untrusted external JSON, so every access is guarded.
interface GitlabPayload {
  object_kind?: string;
  ref?: string;
  before?: string;
  project?: { web_url?: string };
  commits?: Array<{ id?: string; url?: string; message?: string }>;
  object_attributes?: {
    iid?: number;
    url?: string;
    title?: string;
    description?: string;
    state?: string;
    source_branch?: string;
  };
}

// A new branch/tag push carries an all-zero "before" SHA — the same sentinel
// GitHub signals with a separate `create` event.
const ZERO_SHA = /^0+$/;

/**
 * Maps a GitLab webhook payload to zero or more normalized events, keyed off its
 * in-body `object_kind` (GitLab's canonical discriminator, more reliable than the
 * `X-Gitlab-Event` header string). Zero for events we do not model; one for a
 * merge_request; N for a push (one per commit, plus a branch link when the push
 * creates the branch). The ingress dedupes redundant deliveries by state, so
 * emitting a merge_request's current state on every action is safe.
 */
export function normalizeGitlabEvent(
  payload: GitlabPayload
): NormalizedGitEvent[] {
  if (payload.object_kind === "merge_request") return mergeRequestEvent(payload);
  if (payload.object_kind === "push") return pushEvents(payload);
  return [];
}

function mergeRequestEvent(payload: GitlabPayload): NormalizedGitEvent[] {
  const mr = payload.object_attributes;
  if (!mr || typeof mr.iid !== "number" || !mr.url) return [];

  let state: GitLinkState;
  let action: GitAction;
  if (mr.state === "merged") {
    state = "merged";
    action = "git.pr_merged";
  } else if (mr.state === "closed") {
    state = "closed";
    action = "git.pr_closed";
  } else {
    // opened, locked, reopened — anything not terminal reads as open.
    state = "open";
    action = "git.pr_opened";
  }

  return [
    {
      provider: "gitlab",
      kind: "pr",
      externalId: String(mr.iid),
      url: mr.url,
      state,
      title: mr.title ?? null,
      action,
      branch: mr.source_branch,
      // Title and description both carry `#123` references; the source branch
      // carries the `feature/123-slug` form. All three feed resolveTaskRefs.
      messages: [mr.title, mr.description].filter(
        (s): s is string => Boolean(s)
      ),
    },
  ];
}

function pushEvents(payload: GitlabPayload): NormalizedGitEvent[] {
  const branch = (payload.ref ?? "").replace(/^refs\/heads\//, "");
  const commits = Array.isArray(payload.commits) ? payload.commits : [];
  const events: NormalizedGitEvent[] = [];

  // A new-branch push (all-zero "before") mirrors GitHub's `create` branch event:
  // one branch link so a `feature/123-slug` branch tracks its task even before any
  // commit lands. Idempotent — a later push to the same branch has a real "before"
  // and emits no branch link, and the state/url are stable across redeliveries.
  if (branch && payload.ref?.startsWith("refs/heads/") && ZERO_SHA.test(payload.before ?? "")) {
    const webUrl = payload.project?.web_url;
    events.push({
      provider: "gitlab",
      kind: "branch",
      externalId: branch,
      url: webUrl ? `${webUrl}/-/tree/${branch}` : "",
      state: null,
      title: null,
      action: "git.branch_linked",
      branch,
      messages: [],
    });
  }

  for (const c of commits) {
    if (!c || typeof c.id !== "string" || !c.url) continue;
    events.push({
      provider: "gitlab",
      kind: "commit",
      externalId: c.id,
      url: c.url,
      state: null,
      title: c.message ? c.message.split("\n")[0] : null,
      action: "git.commit_linked",
      branch: branch || undefined,
      messages: c.message ? [c.message] : [],
    });
  }
  return events;
}
