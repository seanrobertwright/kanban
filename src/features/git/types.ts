import type { GitAction } from "@/features/activity/types";

/**
 * Git provider connection + link model (2.0) — the shapes Phase 2 hangs from.
 *
 * The activity side of the model (the git.* action family and the GitSnapshot a
 * link event logs) lives in activity/types.ts beside every other snapshot family;
 * this module owns the git *domain* — providers, the connection, the link row,
 * and the normalized event a provider adapter hands the ingress.
 */

export type GitProvider = "github" | "gitlab" | "bitbucket";
export type GitLinkKind = "branch" | "pr" | "commit";
export type GitLinkState = "open" | "merged" | "closed";

export const GIT_PROVIDERS: readonly GitProvider[] = [
  "github",
  "gitlab",
  "bitbucket",
];

export function isGitProvider(v: unknown): v is GitProvider {
  return v === "github" || v === "gitlab" || v === "bitbucket";
}

/** A connected repository. The signing secret is never carried on this shape —
 *  it is decrypted only on the ingress path (connectionForIngress). */
export interface RepoConnection {
  id: number;
  workspaceId: string;
  provider: GitProvider;
  externalRepo: string;
  installId: string | null;
  active: boolean;
  createdBy: string;
  createdAt: string;
  lastEventAt: string | null;
}

/** A branch/PR/commit tied to a task, as the Development section surfaces it. */
export interface TaskGitLink {
  id: number;
  taskId: number;
  connectionId: number | null;
  provider: GitProvider;
  kind: GitLinkKind;
  externalId: string;
  url: string;
  state: GitLinkState | null;
  title: string | null;
  updatedAt: string;
}

/**
 * The provider-agnostic event the ingress consumes. A vendor adapter (2.1 for
 * GitHub) verifies the webhook signature, then maps the provider's payload onto
 * this shape — a single artifact (branch / PR / commit) with the task references
 * it carries. The ingress resolves those references to task ids, upserts the
 * link, and logs `action` so Phase-1 rules can fire.
 *
 * References are split by where they come from because they are parsed
 * differently: `branch` yields at most one task id from its leading numeric
 * segment (`feature/123-slug`), while `messages` (a PR title/body, a commit
 * message) yield the explicit `#123` references they mention. Keeping them apart
 * is what lets branch parsing stay strict enough to ignore version strings.
 */
export interface NormalizedGitEvent {
  provider: GitProvider;
  kind: GitLinkKind;
  externalId: string;
  url: string;
  state: GitLinkState | null;
  title: string | null;
  action: GitAction;
  /** The head branch name, if the event has one (branch/PR events). */
  branch?: string;
  /** Free text to scan for `#123` references (PR title+body, commit messages). */
  messages?: string[];
}

/**
 * A CI run's lifecycle (2.7). `status` is where the run is; `conclusion` is how it
 * ended, set only once `status` is `completed`. Both are provider-normalized —
 * GitHub check_suite and GitLab pipeline statuses fold onto this shared vocabulary.
 */
export type CiStatus = "queued" | "in_progress" | "completed";
export type CiConclusion = "success" | "failure" | "neutral";

/** A build/deploy/pipeline run tied to a task, as the Development section shows it. */
export interface TaskCiStatus {
  id: number;
  taskId: number;
  connectionId: number | null;
  provider: GitProvider;
  externalId: string;
  ref: string | null;
  status: CiStatus;
  conclusion: CiConclusion | null;
  url: string;
  title: string | null;
  updatedAt: string;
}

/**
 * The provider-agnostic CI event the ingress consumes (2.7) — the check/pipeline
 * twin of NormalizedGitEvent. It carries the run's normalized status/conclusion
 * plus the `branch`/`messages` the shared resolver reads to find the task the run
 * is for (a `feature/123-slug` head branch resolves to task 123).
 */
export interface NormalizedCiEvent {
  provider: GitProvider;
  externalId: string;
  ref: string | null;
  status: CiStatus;
  conclusion: CiConclusion | null;
  url: string;
  title: string | null;
  branch?: string;
  messages?: string[];
}

/** One entry in a repository tree listing (2.10) — a file or a directory. */
export interface RepoEntry {
  name: string;
  path: string;
  type: "file" | "dir";
  /** File size in bytes, when the provider reports it (dirs: null). */
  size: number | null;
}

/** A branch in the repository's branch list (2.10). */
export interface RepoBranch {
  name: string;
  protected: boolean;
}

/**
 * A provider release/tag publication (2.8). The ingress matches `tag` to a
 * planned `release` row (by name) in the connection's workspace and ships it.
 * Only a `published` event flips state — a draft or an edit-of-an-existing does
 * not — so a release ships exactly when the tag goes live.
 */
export interface NormalizedReleaseEvent {
  provider: GitProvider;
  tag: string;
  name: string | null;
  url: string;
  notes: string | null;
  published: boolean;
}
