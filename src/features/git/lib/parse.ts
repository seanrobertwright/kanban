import type { NormalizedGitEvent } from "../types";

/**
 * "Smart commit" reference parsing (2.0) — the pure heart of task resolution.
 *
 * A git event names the task it delivers the way every leader's convention does:
 * an explicit `#123` in a PR title / commit message, or a `feature/123-slug`
 * branch name. This module extracts the candidate task ids; the ingress
 * (repository.ts) is what validates them against real tasks in the connection's
 * workspace — a parsed id is a candidate, never a grant.
 */

/**
 * The task id a branch name encodes, or null. Strict on purpose: only the last
 * path segment's *leading* number counts, so `feature/123-add-oauth`, `123-fix`,
 * and `bugfix/123` resolve to 123, while `release/v1.2.3` resolves to nothing.
 *
 * Anchoring to the segment start is what keeps a version string or a date from
 * being read as a task reference — the false-positive class a looser "any number
 * in the branch" pattern would open.
 */
export function parseBranchRef(branch: string | undefined | null): number | null {
  if (!branch) return null;
  const last = branch.split("/").pop() ?? "";
  const m = last.match(/^(\d+)(?:-.*)?$/);
  if (!m) return null;
  const id = Number(m[1]);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/**
 * Every `#123` reference in a blob of text, deduped. The word boundary keeps
 * `#123abc` from matching (a fragment id, not a task reference), and only `#`
 * anchors a reference — a bare number in prose is not one.
 */
export function parseIssueRefs(text: string | undefined | null): number[] {
  if (!text) return [];
  const ids = new Set<number>();
  for (const m of text.matchAll(/#(\d+)\b/g)) {
    const id = Number(m[1]);
    if (Number.isSafeInteger(id) && id > 0) ids.add(id);
  }
  return [...ids];
}

/**
 * The full set of candidate task ids a normalized event references — its branch's
 * encoded id (if any) plus every `#123` in its messages. Deduped; order is not
 * significant (the ingress resolves each independently).
 */
export function resolveTaskRefs(event: NormalizedGitEvent): number[] {
  const ids = new Set<number>();
  const branchId = parseBranchRef(event.branch);
  if (branchId !== null) ids.add(branchId);
  for (const msg of event.messages ?? []) {
    for (const id of parseIssueRefs(msg)) ids.add(id);
  }
  return [...ids];
}
