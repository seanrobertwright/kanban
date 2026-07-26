"use client";

import { useEffect, useState } from "react";

import type { WorkspaceMembership } from "@/features/workspaces/types";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import * as api from "../client/api";
import {
  GIT_PROVIDERS,
  type GitProvider,
  type RepoBranch,
  type RepoConnection,
  type RepoEntry,
} from "../types";
import { Select, SelectItem } from "@/shared/ui/select";

interface RepoConnectionsDialogProps {
  open: boolean;
  workspace: WorkspaceMembership;
  onOpenChange: (open: boolean) => void;
}

const PROVIDER_LABELS: Record<GitProvider, string> = {
  github: "GitHub",
  gitlab: "GitLab",
  bitbucket: "Bitbucket",
};

const TOKEN_PLACEHOLDERS: Record<GitProvider, string> = {
  github: "Fine-grained PAT (contents: read)",
  gitlab: "Personal access token (read_repository)",
  bitbucket: "username:app-password",
};

/**
 * Admin management of the workspace's repo connections (2.0). Follows the
 * webhooks-dialog conventions: the webhook signing secret surfaces exactly
 * once in the amber box; "Rotate" re-POSTs the same provider+repo, which the
 * server upserts with a fresh secret.
 */
export function RepoConnectionsDialog({
  open,
  workspace,
  onOpenChange,
}: RepoConnectionsDialogProps) {
  const [connections, setConnections] = useState<RepoConnection[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [provider, setProvider] = useState<GitProvider>("github");
  const [externalRepo, setExternalRepo] = useState("");
  const [installId, setInstallId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  /** Which connection's read-only browse panel is open. */
  const [browsingId, setBrowsingId] = useState<number | null>(null);
  /** The freshly minted secret and its webhook URL — shown until close. */
  const [minted, setMinted] = useState<{
    repo: string;
    url: string;
    secret: string;
  } | null>(null);
  const [confirmingId, setConfirmingId] = useState<number | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await api.fetchConnections(workspace.id);
        if (!cancelled) setConnections(data);
      } catch (e) {
        if (!cancelled)
          setError(
            e instanceof Error ? e.message : "Could not load repo connections"
          );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, workspace.id, version]);

  async function connect(
    connectProvider: GitProvider,
    repo: string,
    install?: string,
    token?: string
  ) {
    const trimmed = repo.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.createConnection(workspace.id, {
        provider: connectProvider,
        externalRepo: trimmed,
        installId: install?.trim() || undefined,
        // Omitted (a Rotate) keeps any stored token; the server never returns it.
        accessToken: token?.trim() || undefined,
      });
      setMinted({
        repo: `${PROVIDER_LABELS[connectProvider]} ${result.connection.externalRepo}`,
        url: `${window.location.origin}/api/git/webhook/${connectProvider}/${result.connection.id}`,
        secret: result.secret,
      });
      setExternalRepo("");
      setInstallId("");
      setAccessToken("");
      setVersion((v) => v + 1);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not connect the repository"
      );
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: number) {
    setBusy(true);
    setError(null);
    try {
      await api.deleteConnection(id);
      setConfirmingId(null);
      setVersion((v) => v + 1);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not disconnect the repository"
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Closing forgets the secret — shown once means once.
        if (!next) setMinted(null);
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Repositories</DialogTitle>
          <DialogDescription>
            Connect a repo so branches, PRs, commits, CI runs, and releases flow
            onto the tasks that reference them. Point the provider&apos;s webhook
            at the URL minted below, signed with the one-time secret.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        {minted && (
          <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
            <p className="font-medium">Webhook for {minted.repo}</p>
            <p className="mt-1 text-xs">
              Payload URL:{" "}
              <span className="font-mono break-all">{minted.url}</span>
            </p>
            <p className="mt-1 text-xs">
              Secret:{" "}
              <span className="font-mono break-all">{minted.secret}</span>
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Copy the secret now — it is shown only this once. Rotating mints a
              replacement.
            </p>
          </div>
        )}

        {connections.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No repositories connected yet.
          </p>
        ) : (
          <ul className="grid gap-2">
            {connections.map((connection) => (
              <li
                key={connection.id}
                className="grid gap-2 rounded-lg border px-3 py-2 text-sm"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p
                      className="truncate font-medium"
                      title={connection.externalRepo}
                    >
                      {connection.externalRepo}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {PROVIDER_LABELS[connection.provider]}
                      {connection.lastEventAt
                        ? ` · last event ${new Date(connection.lastEventAt).toLocaleString()}`
                        : " · no events yet"}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground"
                      disabled={busy}
                      onClick={() =>
                        setBrowsingId(
                          browsingId === connection.id ? null : connection.id
                        )
                      }
                    >
                      {browsingId === connection.id ? "Hide" : "Browse"}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground"
                      disabled={busy}
                      onClick={() =>
                        connect(
                          connection.provider,
                          connection.externalRepo,
                          connection.installId ?? undefined
                        )
                      }
                    >
                      Rotate
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground hover:text-destructive"
                      disabled={busy}
                      onClick={() =>
                        confirmingId === connection.id
                          ? remove(connection.id)
                          : setConfirmingId(connection.id)
                      }
                      onBlur={() => setConfirmingId(null)}
                    >
                      {confirmingId === connection.id ? "Really?" : "Disconnect"}
                    </Button>
                  </div>
                </div>
                {browsingId === connection.id && (
                  <RepoBrowsePanel connectionId={connection.id} />
                )}
              </li>
            ))}
          </ul>
        )}

        <div className="grid gap-2 border-t pt-3">
          <Label htmlFor="repo-provider">Provider</Label>
          <Select
            id="repo-provider"
            className="h-9 rounded-md px-2"
            value={provider}
            onValueChange={(value) => setProvider(value as GitProvider)}
          >
            {GIT_PROVIDERS.map((p) => (
              <SelectItem key={p} value={p}>
                {PROVIDER_LABELS[p]}
              </SelectItem>
            ))}
          </Select>
          <Label htmlFor="repo-name">Repository</Label>
          <Input
            id="repo-name"
            value={externalRepo}
            onChange={(e) => setExternalRepo(e.target.value)}
            placeholder="owner/name"
          />
          <Label htmlFor="repo-install-id">Install id (optional)</Label>
          <Input
            id="repo-install-id"
            value={installId}
            onChange={(e) => setInstallId(e.target.value)}
            placeholder="GitHub App installation id"
          />
          <Label htmlFor="repo-access-token">
            Access token (optional, for browsing)
          </Label>
          <Input
            id="repo-access-token"
            type="password"
            autoComplete="off"
            value={accessToken}
            onChange={(e) => setAccessToken(e.target.value)}
            placeholder={TOKEN_PLACEHOLDERS[provider]}
          />
          <p className="text-xs text-muted-foreground">
            Lets members browse the repo&apos;s branches and files from here.
            Stored encrypted, never shown again; leave blank on a rotate to keep
            the current token.
          </p>
          <div className="flex justify-end">
            <Button
              type="button"
              size="sm"
              disabled={busy || !externalRepo.trim()}
              onClick={() => connect(provider, externalRepo, installId, accessToken)}
            >
              Connect repository
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Read-only repository browser (2.10): a branch picker over the /branches
 * endpoint and a file listing over /tree. Navigation is client state only —
 * every listing is fetched live from the provider through the proxy, nothing
 * is stored. Errors surface inline (the commonest being a connection without
 * an access token pointed at a private repo).
 */
function RepoBrowsePanel({ connectionId }: { connectionId: number }) {
  const [branches, setBranches] = useState<RepoBranch[]>([]);
  const [ref, setRef] = useState("");
  const [path, setPath] = useState("");
  const [entries, setEntries] = useState<RepoEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [branchList, tree] = await Promise.all([
          api.fetchRepoBranches(connectionId).catch(() => [] as RepoBranch[]),
          api.fetchRepoTree(connectionId, {
            path: path || undefined,
            ref: ref || undefined,
          }),
        ]);
        if (cancelled) return;
        if (branchList.length > 0) setBranches(branchList);
        setEntries(tree);
      } catch (e) {
        if (!cancelled) {
          setEntries(null);
          setError(e instanceof Error ? e.message : "Could not browse the repository");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [connectionId, ref, path]);

  const parent = path.includes("/")
    ? path.slice(0, path.lastIndexOf("/"))
    : "";

  return (
    <div className="grid gap-1.5 rounded-md bg-muted/40 p-2 text-xs">
      <div className="flex items-center gap-1.5">
        <Select
          aria-label="Branch"
          className="h-7 rounded-md px-1 text-xs"
          value={ref}
          onValueChange={(value) => {
            setRef(value);
            setPath("");
          }}
        >
          <SelectItem value="">default branch</SelectItem>
          {branches.map((b) => (
            <SelectItem key={b.name} value={b.name}>
              {b.name}
              {b.protected ? " (protected)" : ""}
            </SelectItem>
          ))}
        </Select>
        <span className="truncate text-muted-foreground">/{path}</span>
        {loading && <span className="ml-auto text-muted-foreground">Loading…</span>}
      </div>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {entries && (
        <ul className="grid max-h-48 gap-0.5 overflow-y-auto">
          {path !== "" && (
            <li>
              <button
                type="button"
                className="text-muted-foreground hover:underline"
                onClick={() => setPath(parent)}
              >
                ..
              </button>
            </li>
          )}
          {entries.length === 0 && (
            <li className="text-muted-foreground">Empty directory.</li>
          )}
          {entries.map((entry) => (
            <li key={entry.path} className="flex items-center justify-between gap-2">
              {entry.type === "dir" ? (
                <button
                  type="button"
                  className="truncate text-left hover:underline"
                  onClick={() => setPath(entry.path)}
                >
                  {entry.name}/
                </button>
              ) : (
                <span className="truncate">{entry.name}</span>
              )}
              {entry.size !== null && (
                <span className="shrink-0 text-muted-foreground">
                  {entry.size.toLocaleString()} B
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
