import { queryOne } from "@/shared/db/client";
import { decryptSecret } from "@/shared/crypto/secret-box";
import type { Principal } from "@/features/auth/server/principal";
import {
  AuthzError,
  requireWorkspaceRole,
} from "@/features/workspaces/server/authz";
import {
  normalizeBitbucketBranches,
  normalizeBitbucketTree,
  normalizeGithubBranches,
  normalizeGithubTree,
  normalizeGitlabBranches,
  normalizeGitlabTree,
} from "../lib/browse";
import type { GitProvider, RepoBranch, RepoEntry } from "../types";

/**
 * Repository browsing (2.10) — the provider-server half. A read-through proxy:
 * calls the connected provider's contents/branches API with the connection's
 * access token (078), normalizes the response (lib/browse), and returns it. No
 * repo data is stored — the self-hosted "hold only what we must" stance — so this
 * is a pass-through, not a mirror.
 *
 * Gate: viewer+ of the workspace that owns the connection (a board's code is
 * visible to anyone who can see the board's workspace). The provider HTTP call is
 * injected (`deps.fetchImpl`) so the normalization + gate are testable without a
 * network; the default is the global fetch.
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
  /** The decrypted browse token, or null when none was configured. */
  accessToken: string | null;
}

async function connectionForBrowse(
  principal: string | Principal,
  id: number
): Promise<BrowseConnection> {
  const row = await queryOne<BrowseConnection & { accessToken: string | null }>(
    `SELECT id, workspace_id AS "workspaceId", provider,
            external_repo AS "externalRepo", access_token AS "accessToken"
       FROM repo_connection WHERE id = $1 AND active`,
    [id]
  );
  if (!row) throw new AuthzError("not_found", "Connection not found");
  await requireWorkspaceRole(principal, row.workspaceId, "viewer");
  let accessToken: string | null = null;
  if (row.accessToken) {
    try {
      accessToken = decryptSecret(row.accessToken);
    } catch {
      // A rotated ENCRYPTION_KEY orphans the token — treat as unconfigured
      // rather than failing every browse with a crypto error.
      accessToken = null;
    }
  }
  return { ...row, accessToken };
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
  // Bitbucket 2.0 src API: the revision is a path segment, so an unspecified
  // ref browses HEAD (any git revision syntax the server resolves).
  const rev = encodeURIComponent(ref ?? "HEAD");
  return `https://api.bitbucket.org/2.0/repositories/${conn.externalRepo}/src/${rev}/${p}?pagelen=100`;
}

function branchesUrl(conn: BrowseConnection): string {
  if (conn.provider === "github") {
    return `https://api.github.com/repos/${conn.externalRepo}/branches`;
  }
  if (conn.provider === "gitlab") {
    return `https://gitlab.com/api/v4/projects/${gitlabProject(conn.externalRepo)}/repository/branches`;
  }
  return `https://api.bitbucket.org/2.0/repositories/${conn.externalRepo}/refs/branches?pagelen=100`;
}

/**
 * The auth header the provider call bears, from the connection's decrypted
 * access token (078). Per provider: GitHub takes a PAT as a bearer token,
 * GitLab takes it in PRIVATE-TOKEN, and Bitbucket takes basic auth with a
 * `username:app-password` pair. A tokenless connection sends no credential —
 * public repos still browse; private ones answer with the provider's 401/403,
 * surfaced by the callers below.
 */
function authHeaders(
  provider: GitProvider,
  token: string | null
): { headers: Record<string, string> } {
  const headers: Record<string, string> = { accept: "application/json" };
  if (token) {
    if (provider === "github") headers.authorization = `Bearer ${token}`;
    else if (provider === "gitlab") headers["private-token"] = token;
    else headers.authorization = `Basic ${Buffer.from(token, "utf8").toString("base64")}`;
  }
  return { headers };
}

function normalizeTree(provider: GitProvider, json: unknown): RepoEntry[] {
  if (provider === "gitlab") return normalizeGitlabTree(json);
  if (provider === "bitbucket") return normalizeBitbucketTree(json);
  return normalizeGithubTree(json);
}

function normalizeBranches(provider: GitProvider, json: unknown): RepoBranch[] {
  if (provider === "gitlab") return normalizeGitlabBranches(json);
  if (provider === "bitbucket") return normalizeBitbucketBranches(json);
  return normalizeGithubBranches(json);
}

export async function browseRepoTree(
  principal: string | Principal,
  connectionId: number,
  opts: { path?: string; ref?: string },
  deps: { fetchImpl?: FetchLike } = {}
): Promise<RepoEntry[]> {
  const conn = await connectionForBrowse(principal, connectionId);
  const fetchImpl = deps.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  const res = await fetchImpl(
    treeUrl(conn, opts.path ?? "", opts.ref),
    authHeaders(conn.provider, conn.accessToken)
  );
  if (!res.ok) {
    throw new AuthzError("conflict", `The provider responded ${res.status}`);
  }
  const json = await res.json();
  return normalizeTree(conn.provider, json);
}

export async function listRepoBranches(
  principal: string | Principal,
  connectionId: number,
  deps: { fetchImpl?: FetchLike } = {}
): Promise<RepoBranch[]> {
  const conn = await connectionForBrowse(principal, connectionId);
  const fetchImpl = deps.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  const res = await fetchImpl(
    branchesUrl(conn),
    authHeaders(conn.provider, conn.accessToken)
  );
  if (!res.ok) {
    throw new AuthzError("conflict", `The provider responded ${res.status}`);
  }
  const json = await res.json();
  return normalizeBranches(conn.provider, json);
}
