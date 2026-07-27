"use client";

import { useCallback, useState } from "react";
import { Trash2 } from "lucide-react";

import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import * as api from "@/features/workspaces/client/api";
import type { WorkspaceMembership } from "@/features/workspaces/types";
import { usePanelLoad } from "./use-panel-load";
import type { IpAllowlistEntry } from "../types";
import { EnterpriseControls } from "./enterprise-controls";

/**
 * Network policy and the compliance surfaces beneath it: retention, legal
 * holds, identity providers, connected integrations, installed extensions
 * (EnterpriseControls owns those, and loads them itself).
 *
 * The allowlist is owner-only to change and admin-visible to read, which is why
 * the form is conditional but the list is not — an admin diagnosing a locked-out
 * colleague needs to see the ranges without being able to widen them.
 */
export function SecurityPanel({ workspace }: { workspace: WorkspaceMembership }) {
  const owner = workspace.role === "owner";
  const [entries, setEntries] = useState<IpAllowlistEntry[]>([]);
  const [cidr, setCidr] = useState("");
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setEntries(await api.fetchIpAllowlist(workspace.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load network policy");
    }
  }, [workspace.id]);

  usePanelLoad(load);

  async function run(what: string, action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : `Could not ${what}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6">
      <section className="grid gap-3">
        <div>
          <h3 className="text-sm font-medium">IP allowlist</h3>
          <p className="text-xs text-muted-foreground">
            Enforcement is active only when the deployment enables it with a
            trusted proxy header. See enterprise deployment notes.
          </p>
        </div>

        {!owner && (
          <p className="text-xs text-muted-foreground">
            Only workspace owners can change this policy.
          </p>
        )}
        {owner && (
          <div className="grid gap-2">
            <Label htmlFor="allow-cidr">CIDR range</Label>
            <div className="flex gap-2">
              <Input
                id="allow-cidr"
                value={cidr}
                onChange={(e) => setCidr(e.target.value)}
                placeholder="203.0.113.0/24"
              />
              <Input
                aria-label="Range label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Office (optional)"
              />
              <Button
                disabled={busy || !cidr.trim()}
                onClick={() =>
                  void run("save network policy", async () => {
                    await api.addIpAllowlistEntry(workspace.id, cidr, label);
                    setCidr("");
                    setLabel("");
                  })
                }
              >
                Add
              </Button>
            </div>
          </div>
        )}

        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}

        <div className="grid gap-1">
          {entries.length === 0 ? (
            <p className="text-sm text-muted-foreground">No network restrictions.</p>
          ) : (
            entries.map((entry) => (
              <div
                key={entry.id}
                className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm"
              >
                <code className="flex-1">{entry.cidr}</code>
                <span className="text-xs text-muted-foreground">{entry.label}</span>
                {owner && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    aria-label={`Remove ${entry.cidr}`}
                    disabled={busy}
                    onClick={() =>
                      void run("remove network policy", () =>
                        api.deleteIpAllowlistEntry(workspace.id, entry.id)
                      )
                    }
                  >
                    <Trash2 />
                  </Button>
                )}
              </div>
            ))
          )}
        </div>
      </section>

      <div className="border-t pt-5">
        <EnterpriseControls workspace={workspace} />
      </div>
    </div>
  );
}
