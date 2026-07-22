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
