import { queryOne } from "@/shared/db/client";
import type { Principal } from "@/features/auth/server/principal";
import {
  AuthzError,
  requireWorkspaceRole,
} from "@/features/workspaces/server/authz";
import {
  normalizeGithubBranches,
  normalizeGithubTree,
  normalizeGitlabBranches,
  normalizeGitlabTree,
} from "../lib/browse";
import type { GitProvider, RepoBranch, RepoEntry } from "../types";

/**
 * Repository browsing (2.10) — the provider-server half. A read-through proxy:
 * calls the connected provider's contents/branches API with the connection's
 * installation token, normalizes the response (lib/browse), and returns it. No
 * repo data is stored — the self-hosted "hold only what we must" stance — so this
 * is a pass-through, not a mirror.
 *
 * Gate: viewer+ of the workspace that owns the connection (a board's code is
 * visible to anyone who can see the board's workspace). The provider HTTP call is
 * injected (`deps.fetchImpl`) so the normalization + gate are testable without a
 * network; the default is the global fetch, and the installation-token retrieval +
 * response caching are the live-only surface layered on top.
 */

/** A minimal fetch shape — global `fetch` satisfies it, and a test can stub it. */
export interface FetchLike {
  (url: string, init?: { headers?: Record<string, string> }): Promise<{
    ok: boolean;
    status: number;
    json: () => Promise<unknown>;
  }>;
}

interface BrowseConnection {
  id: number;
  workspaceId: string;
  provider: GitProvider;
  externalRepo: string;
}

async function connectionForBrowse(
  principal: string | Principal,
  id: number
): Promise<BrowseConnection> {
  const row = await queryOne<BrowseConnection>(
    `SELECT id, workspace_id AS "workspaceId", provider, external_repo AS "externalRepo"
       FROM repo_connection WHERE id = $1 AND active`,
    [id]
  );
  if (!row) throw new AuthzError("not_found", "Connection not found");
  await requireWorkspaceRole(principal, row.workspaceId, "viewer");
  return row;
}

/** GitLab addresses a project by URL-encoded `owner/name`; GitHub by the path. */
function gitlabProject(repo: string): string {
  return encodeURIComponent(repo);
}

/**
 * Sanitizes a caller-supplied repo path into something safe to splice into a
 * provider URL. Each segment is percent-encoded (so `?`, `#`, spaces, and other
 * URL metacharacters cannot break out of the path), and empty / `.` / `..`
 * segments are dropped — without this, a `path` of `../../owner/repo/contents`
 * would `..`-normalize in the URL parser to a *different repository*, a
 * scope-bypass past the connection's own repo. The `/` separators are the only
 * structure preserved.
 */
function sanitizePath(path: string): string {
  return path
    .split("/")
    .filter((seg) => seg && seg !== "." && seg !== "..")
    .map(encodeURIComponent)
    .join("/");
}

function treeUrl(conn: BrowseConnection, path: string, ref?: string): string {
  const p = sanitizePath(path);
  if (conn.provider === "github") {
    const q = ref ? `?ref=${encodeURIComponent(ref)}` : "";
    return `https://api.github.com/repos/${conn.externalRepo}/contents/${p}${q}`;
  }
  if (conn.provider === "gitlab") {
    // path rides a query param (URLSearchParams encodes it) and the project is
    // fixed in the URL path, so traversal can't escape the project — but pass the
    // sanitized form anyway, one rule for both providers.
    const q = new URLSearchParams({ path: p, ...(ref ? { ref } : {}) });
    return `https://gitlab.com/api/v4/projects/${gitlabProject(conn.externalRepo)}/repository/tree?${q}`;
  }
  throw new AuthzError("conflict", "Repository browsing is not yet available for Bitbucket");
}

function branchesUrl(conn: BrowseConnection): string {
  if (conn.provider === "github") {
    return `https://api.github.com/repos/${conn.externalRepo}/branches`;
  }
  if (conn.provider === "gitlab") {
    return `https://gitlab.com/api/v4/projects/${gitlabProject(conn.externalRepo)}/repository/branches`;
  }
  throw new AuthzError("conflict", "Repository browsing is not yet available for Bitbucket");
}

/** The installation token the provider call bears. Live-only — filled by the
 *  OAuth/App handshake (2.1); absent in the sandbox, where the injected fetch
 *  needs no auth. */
function authHeaders(): { headers: Record<string, string> } {
  return { headers: { accept: "application/json" } };
}

export async function browseRepoTree(
  principal: string | Principal,
  connectionId: number,
  opts: { path?: string; ref?: string },
  deps: { fetchImpl?: FetchLike } = {}
): Promise<RepoEntry[]> {
  const conn = await connectionForBrowse(principal, connectionId);
  const fetchImpl = deps.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  const res = await fetchImpl(treeUrl(conn, opts.path ?? "", opts.ref), authHeaders());
  if (!res.ok) {
    throw new AuthzError("conflict", `The provider responded ${res.status}`);
  }
  const json = await res.json();
  return conn.provider === "gitlab" ? normalizeGitlabTree(json) : normalizeGithubTree(json);
}

export async function listRepoBranches(
  principal: string | Principal,
  connectionId: number,
  deps: { fetchImpl?: FetchLike } = {}
): Promise<RepoBranch[]> {
  const conn = await connectionForBrowse(principal, connectionId);
  const fetchImpl = deps.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  const res = await fetchImpl(branchesUrl(conn), authHeaders());
  if (!res.ok) {
    throw new AuthzError("conflict", `The provider responded ${res.status}`);
  }
  const json = await res.json();
  return conn.provider === "gitlab"
    ? normalizeGitlabBranches(json)
    : normalizeGithubBranches(json);
}
