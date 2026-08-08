"use client";

import { useCallback, useState } from "react";
import { Loader2, X } from "lucide-react";

import { usePanelLoad } from "@/features/admin/components/use-panel-load";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";

interface ApiKeyRow {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
}

/**
 * Personal API keys — the settings surface for the CLI's human credential
 * (user-key.ts). Deliberately per-user, not per-workspace: the list is the
 * caller's own keys and nothing else, which is why this panel takes no
 * workspace prop and does no role gating.
 *
 * The minted token is held on screen until dismissed, the AgentsDialog
 * pattern: it exists once, in the create response, and a reload can never
 * fetch it back.
 */
export function ApiKeysPanel() {
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [mintedToken, setMintedToken] = useState<string | null>(null);
  // The id armed for the two-click Really? confirm, the label-delete pattern.
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/user/api-keys");
      if (!res.ok) throw new Error(`Failed to load keys (${res.status})`);
      setKeys(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load keys");
    } finally {
      setLoading(false);
    }
  }, []);

  usePanelLoad(load);

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/user/api-keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `Failed to create key (${res.status})`);
      setMintedToken(body.token);
      setName("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create key");
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(key: ApiKeyRow) {
    if (confirmingId !== key.id) {
      setConfirmingId(key.id);
      return;
    }
    setConfirmingId(null);
    setError(null);
    try {
      const res = await fetch(`/api/user/api-keys/${key.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`Failed to revoke (${res.status})`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to revoke key");
    }
  }

  const dateFmt = (iso: string) => new Date(iso).toLocaleDateString();

  return (
    <div className="grid gap-3">
      <form onSubmit={handleCreate} className="grid gap-2 rounded-lg border p-3">
        <Label htmlFor="api-key-name">Mint a key</Label>
        <div className="flex gap-2">
          <Input
            id="api-key-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="laptop CLI"
            maxLength={100}
            className="flex-1"
          />
          <Button type="submit" disabled={creating || !name.trim()}>
            {creating ? <Loader2 className="animate-spin" /> : "Create"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          A key acts as you — same boards, same role — from the CLI or a script.
          Present it in the <code className="font-mono">x-user-key</code> header.
        </p>
      </form>

      {mintedToken && (
        <div className="grid gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-3">
          <p className="text-xs font-medium">
            Your key — copy it now. It is shown once and cannot be recovered.
          </p>
          <code className="block overflow-x-auto rounded bg-background px-2 py-1.5 font-mono text-xs">
            {mintedToken}
          </code>
          <Button
            variant="secondary"
            size="sm"
            className="justify-self-end"
            onClick={() => setMintedToken(null)}
          >
            Done
          </Button>
        </div>
      )}

      {error && (
        <p
          role="alert"
          className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive"
        >
          {error}
        </p>
      )}

      <div className="grid gap-1">
        {loading && keys.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">Loading…</p>
        ) : keys.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            No keys yet.
          </p>
        ) : (
          keys.map((key) => (
            <div key={key.id} className="flex items-center gap-3 rounded-lg px-1 py-1.5">
              <div className="grid min-w-0 flex-1 gap-0.5">
                <span className="truncate text-sm font-medium">{key.name}</span>
                <span className="truncate text-xs text-muted-foreground">
                  created {dateFmt(key.createdAt)}
                  {key.lastUsedAt
                    ? ` · last used ${dateFmt(key.lastUsedAt)}`
                    : " · never used"}
                </span>
              </div>
              <Button
                variant={confirmingId === key.id ? "destructive" : "ghost"}
                size={confirmingId === key.id ? "sm" : "icon"}
                className={confirmingId === key.id ? undefined : "size-7 text-muted-foreground"}
                aria-label={`Revoke ${key.name}`}
                onClick={() => handleRevoke(key)}
                onBlur={() => setConfirmingId(null)}
              >
                {confirmingId === key.id ? "Really?" : <X />}
              </Button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
