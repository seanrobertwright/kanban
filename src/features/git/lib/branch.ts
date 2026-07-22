/**
 * Branch-name generation (2.6) — the inverse of parseBranchRef. "Create a branch
 * from this task" needs the name to create, and it must be one the ingress will
 * later resolve *back* to the task: the round-trip
 * `parseBranchRef(suggestBranchName(id, title)) === id` is the invariant a test
 * pins, because a name we suggest but cannot re-link would silently break tracking.
 *
 * The provider-API call that actually opens the branch is live-only (it needs a
 * real installation token); this pure half is what that call, an agent tool, or a
 * copy-paste affordance all share.
 */

/** Slugify a title into a branch-safe tail: lowercase, non-alphanumeric runs → a
 *  single dash, trimmed, and capped so the ref stays short. */
function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, ""); // a trailing dash the cap may have left
}

/**
 * The branch name to create for a task: `feature/<id>-<slug>`, or `feature/<id>`
 * when the title slugifies to nothing. The leading numeric segment is what
 * parseBranchRef reads, so the name always links back to its task.
 */
export function suggestBranchName(taskId: number, title: string): string {
  const slug = slugify(title);
  return slug ? `feature/${taskId}-${slug}` : `feature/${taskId}`;
}
