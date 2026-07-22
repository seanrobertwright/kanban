import { createHmac, timingSafeEqual } from "node:crypto";

import type { GitAction } from "@/features/activity/types";
import type {
  CiConclusion,
  CiStatus,
  GitLinkState,
  NormalizedCiEvent,
  NormalizedGitEvent,
  NormalizedReleaseEvent,
} from "../types";

/**
 * GitHub App adapter (2.1) — the vendor-specific half of the git spine (2.0). It
 * does two provider-specific things and nothing else: verify GitHub's webhook
 * signature, and map GitHub's payloads onto the provider-agnostic
 * NormalizedGitEvent the ingress consumes. Everything downstream (task
 * resolution, link upsert, rule firing) is 2.0's, shared with GitLab/Bitbucket.
 *
 * The GitHub App install handshake (redirect → consent → store installation id)
 * and the installation-token REST calls (2.6 branch creation, 2.7 CI status
 * backfill) are the remaining vendor surface; they need real App credentials
 * (app id + private key) and so are wired but exercised against the live API, not
 * here. The webhook-receiving contract below is the testable core and is what
 * makes a connected repo drive a board.
 */

/**
 * Verifies GitHub's `X-Hub-Signature-256` over the exact request body, using the
 * connection's signing secret. GitHub sends `sha256=<hex hmac>`; we recompute and
 * compare in constant time. A missing or wrong-length header fails closed before
 * the compare, since timingSafeEqual throws on a length mismatch.
 *
 * The body MUST be the raw bytes GitHub sent — verify before JSON.parse, never
 * re-serialize — because a re-encoded body would not reproduce the same HMAC.
 */
export function verifyGithubSignature(
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

// GitHub's webhook payloads, narrowed to the fields the adapter reads. Loose by
// design — a payload is untrusted external JSON, so every access is guarded.
interface GithubPayload {
  action?: string;
  ref?: string;
  ref_type?: string;
  repository?: { full_name?: string };
  pull_request?: {
    number?: number;
    html_url?: string;
    title?: string;
    body?: string;
    state?: string;
    merged?: boolean;
    head?: { ref?: string };
  };
  commits?: Array<{ id?: string; url?: string; message?: string }>;
  check_suite?: {
    id?: number;
    head_branch?: string;
    head_sha?: string;
    status?: string;
    conclusion?: string | null;
    app?: { name?: string };
  };
  release?: {
    tag_name?: string;
    name?: string | null;
    html_url?: string;
    body?: string | null;
    draft?: boolean;
  };
}

/**
 * Folds a GitHub check_suite conclusion onto the normalized vocabulary. GitHub has
 * many terminal conclusions; only `success` is a pass, `neutral`/`skipped` are a
 * non-failure that fires no rule, and everything else (failure, cancelled,
 * timed_out, action_required, stale) is a failure.
 */
function githubConclusion(raw: string | null | undefined): CiConclusion | null {
  if (!raw) return null;
  if (raw === "success") return "success";
  if (raw === "neutral" || raw === "skipped") return "neutral";
  return "failure";
}

/**
 * Maps a GitHub webhook (its `X-GitHub-Event` type + parsed payload) to zero or
 * more normalized events. Zero for events we do not model; one for a pull_request
 * or a branch create; N for a push (one per commit). The ingress dedupes
 * redundant deliveries by state, so emitting a pull_request's current state on
 * every action (opened, synchronize, …) is safe — an unchanged state is a no-op.
 */
export function normalizeGithubEvent(
  eventType: string,
  payload: GithubPayload
): NormalizedGitEvent[] {
  if (eventType === "pull_request") return pullRequestEvent(payload);
  if (eventType === "push") return pushEvents(payload);
  if (eventType === "create" && payload.ref_type === "branch") {
    return branchCreateEvent(payload);
  }
  return [];
}

function pullRequestEvent(payload: GithubPayload): NormalizedGitEvent[] {
  const pr = payload.pull_request;
  if (!pr || typeof pr.number !== "number" || !pr.html_url) return [];

  let state: GitLinkState;
  let action: GitAction;
  if (pr.merged) {
    state = "merged";
    action = "git.pr_merged";
  } else if (pr.state === "closed") {
    state = "closed";
    action = "git.pr_closed";
  } else {
    state = "open";
    action = "git.pr_opened";
  }

  return [
    {
      provider: "github",
      kind: "pr",
      externalId: String(pr.number),
      url: pr.html_url,
      state,
      title: pr.title ?? null,
      action,
      branch: pr.head?.ref,
      // Title and body both carry `#123` references; the branch name carries the
      // `feature/123-slug` form. All three feed resolveTaskRefs.
      messages: [pr.title, pr.body].filter((s): s is string => Boolean(s)),
    },
  ];
}

function pushEvents(payload: GithubPayload): NormalizedGitEvent[] {
  const branch = (payload.ref ?? "").replace(/^refs\/heads\//, "");
  const commits = Array.isArray(payload.commits) ? payload.commits : [];
  const events: NormalizedGitEvent[] = [];
  for (const c of commits) {
    if (!c || typeof c.id !== "string" || !c.url) continue;
    events.push({
      provider: "github",
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

/**
 * Maps a GitHub `check_suite` webhook to a normalized CI event (2.7), or null for
 * one we cannot tie to a task (no head branch). The run is resolved to a task by
 * its head branch (`feature/123-slug`), reusing 2.0's smart-commit parsing.
 */
export function normalizeGithubCiEvent(
  eventType: string,
  payload: GithubPayload
): NormalizedCiEvent | null {
  if (eventType !== "check_suite") return null;
  const cs = payload.check_suite;
  if (!cs || typeof cs.id !== "number" || !cs.head_branch) return null;

  const status: CiStatus =
    cs.status === "completed"
      ? "completed"
      : cs.status === "in_progress"
        ? "in_progress"
        : "queued";
  const conclusion = status === "completed" ? githubConclusion(cs.conclusion) : null;
  const repo = payload.repository?.full_name;

  return {
    provider: "github",
    externalId: String(cs.id),
    ref: cs.head_branch,
    status,
    conclusion,
    url: repo && cs.head_sha ? `https://github.com/${repo}/commit/${cs.head_sha}/checks` : "",
    title: cs.app?.name ?? null,
    branch: cs.head_branch,
  };
}

/**
 * Maps a GitHub `release` webhook to a normalized release event (2.8), or null.
 * Only a `published`/`released` action on a non-draft release ships a version —
 * a `created` draft or a `deleted` does not flip a planned release.
 */
export function normalizeGithubReleaseEvent(
  eventType: string,
  payload: GithubPayload
): NormalizedReleaseEvent | null {
  if (eventType !== "release") return null;
  const r = payload.release;
  if (!r || !r.tag_name) return null;
  const published =
    (payload.action === "published" || payload.action === "released") && !r.draft;
  return {
    provider: "github",
    tag: r.tag_name,
    name: r.name ?? null,
    url: r.html_url ?? "",
    notes: r.body ?? null,
    published,
  };
}

function branchCreateEvent(payload: GithubPayload): NormalizedGitEvent[] {
  const branch = payload.ref;
  if (!branch) return [];
  const repo = payload.repository?.full_name;
  return [
    {
      provider: "github",
      kind: "branch",
      externalId: branch,
      url: repo ? `https://github.com/${repo}/tree/${branch}` : "",
      state: null,
      title: null,
      action: "git.branch_linked",
      branch,
      messages: [],
    },
  ];
}
