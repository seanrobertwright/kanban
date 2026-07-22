import type { RepoBranch, RepoEntry } from "../types";

/**
 * Repository browsing (2.10) — the pure half. Each provider's contents/branches
 * API returns a different JSON shape; these normalizers fold them onto the
 * provider-agnostic RepoEntry / RepoBranch the browser UI renders. The live
 * fetch (with the connection's installation token, cached) is the provider-server
 * half; this is what makes the response uniform and is what a test can pin without
 * a network.
 *
 * Directories sort before files, then by name — a stable, conventional tree order
 * the UI can render without re-sorting.
 */

function sortEntries(entries: RepoEntry[]): RepoEntry[] {
  return entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

interface GithubEntry {
  name?: string;
  path?: string;
  type?: string;
  size?: number;
}

/** GitHub `GET /repos/{repo}/contents/{path}` — an array (dir) or one object (file). */
export function normalizeGithubTree(payload: unknown): RepoEntry[] {
  const rows: GithubEntry[] = Array.isArray(payload)
    ? (payload as GithubEntry[])
    : payload && typeof payload === "object"
      ? [payload as GithubEntry]
      : [];
  const entries: RepoEntry[] = [];
  for (const r of rows) {
    if (!r || typeof r.name !== "string" || typeof r.path !== "string") continue;
    const type = r.type === "dir" ? "dir" : "file";
    entries.push({ name: r.name, path: r.path, type, size: type === "file" ? r.size ?? null : null });
  }
  return sortEntries(entries);
}

interface GithubBranch {
  name?: string;
  protected?: boolean;
}

/** GitHub `GET /repos/{repo}/branches` — `[{ name, protected }]`. */
export function normalizeGithubBranches(payload: unknown): RepoBranch[] {
  const rows: GithubBranch[] = Array.isArray(payload) ? (payload as GithubBranch[]) : [];
  return rows
    .filter((b): b is GithubBranch => Boolean(b) && typeof b.name === "string")
    .map((b) => ({ name: b.name as string, protected: Boolean(b.protected) }));
}

interface GitlabEntry {
  name?: string;
  path?: string;
  type?: string;
}

/** GitLab `GET /projects/{id}/repository/tree` — `[{ name, path, type: tree|blob }]`. */
export function normalizeGitlabTree(payload: unknown): RepoEntry[] {
  const rows: GitlabEntry[] = Array.isArray(payload) ? (payload as GitlabEntry[]) : [];
  const entries: RepoEntry[] = [];
  for (const r of rows) {
    if (!r || typeof r.name !== "string" || typeof r.path !== "string") continue;
    entries.push({
      name: r.name,
      path: r.path,
      type: r.type === "tree" ? "dir" : "file",
      size: null, // GitLab's tree endpoint does not report size
    });
  }
  return sortEntries(entries);
}

interface GitlabBranch {
  name?: string;
  protected?: boolean;
}

/** GitLab `GET /projects/{id}/repository/branches` — `[{ name, protected }]`. */
export function normalizeGitlabBranches(payload: unknown): RepoBranch[] {
  const rows: GitlabBranch[] = Array.isArray(payload) ? (payload as GitlabBranch[]) : [];
  return rows
    .filter((b): b is GitlabBranch => Boolean(b) && typeof b.name === "string")
    .map((b) => ({ name: b.name as string, protected: Boolean(b.protected) }));
}
