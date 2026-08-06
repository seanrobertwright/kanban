"use client";

// Aliased: `Webhook` is this feature's own type, and the icon would shadow it.
import { Webhook as WebhookIcon } from "lucide-react";
import { EmptyState } from "@/shared/ui/empty-state";
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
import type { Webhook, WebhookDelivery } from "../types";

interface WebhooksDialogProps {
  open: boolean;
  workspace: WorkspaceMembership;
  onOpenChange: (open: boolean) => void;
}

/**
 * Admin management of the workspace's outbound webhooks (025). The signing
 * secret surfaces exactly once, in the amber box, the agents-dialog
 * convention — there is no way to re-fetch it, only to mint a replacement.
 */
export function WebhooksDialog({
  open,
  workspace,
  onOpenChange,
}: WebhooksDialogProps) {
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState("");
  /** The freshly minted secret — shown until the dialog closes. */
  const [minted, setMinted] = useState<{ url: string; secret: string } | null>(
    null
  );
  const [confirmingId, setConfirmingId] = useState<number | null>(null);
  const [version, setVersion] = useState(0);
  /** Which webhook's delivery log is expanded, and the rows for it. */
  const [showingLog, setShowingLog] = useState<number | null>(null);
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await api.fetchWebhooks(workspace.id);
        if (!cancelled) setWebhooks(data);
      } catch (e) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "Could not load webhooks");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, workspace.id, version]);

  async function create() {
    const trimmed = url.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      const eventList = events
        .split(",")
        .map((e) => e.trim())
        .filter(Boolean);
      const result = await api.createWebhook(
        workspace.id,
        trimmed,
        eventList.length ? eventList : undefined
      );
      setMinted({ url: result.webhook.url, secret: result.secret });
      setUrl("");
      setEvents("");
      setVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the webhook");
    } finally {
      setBusy(false);
    }
  }

  /** Pause or resume: the edit an admin with a noisy endpoint used to make by
   *  deleting the webhook and rebuilding it later from memory. */
  async function togglePaused(hook: Webhook) {
    setBusy(true);
    setError(null);
    try {
      await api.updateWebhook(hook.id, { active: !hook.active });
      setVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update the webhook");
    } finally {
      setBusy(false);
    }
  }

  /** A new signing secret, shown once in the amber box like a minted one. */
  async function rotate(hook: Webhook) {
    setBusy(true);
    setError(null);
    try {
      const result = await api.updateWebhook(hook.id, { rotateSecret: true });
      if (result.secret) setMinted({ url: result.webhook.url, secret: result.secret });
      setVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not rotate the secret");
    } finally {
      setBusy(false);
    }
  }

  /** Toggle the delivery log for one webhook, fetching it on first open. */
  async function toggleDeliveries(id: number) {
    if (showingLog === id) {
      setShowingLog(null);
      return;
    }
    setShowingLog(id);
    setError(null);
    try {
      setDeliveries(await api.fetchDeliveries(id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load deliveries");
    }
  }

  async function remove(id: number) {
    setBusy(true);
    setError(null);
    try {
      await api.deleteWebhook(id);
      setConfirmingId(null);
      setVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete the webhook");
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
          <DialogTitle>Webhooks</DialogTitle>
          <DialogDescription>
            POST every board event to your own endpoints — n8n, Zapier, CI, or
            anything that speaks HTTP. Payloads are signed
            (x-kanban-signature-256).
          </DialogDescription>
        </DialogHeader>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        {minted && (
          <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
            <p className="font-medium">Signing secret for {minted.url}</p>
            <p className="mt-1 font-mono text-xs break-all">{minted.secret}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Copy it now — it is shown only this once.
            </p>
          </div>
        )}

        {webhooks.length === 0 ? (
          <EmptyState icon={WebhookIcon} title="No webhooks yet" hint="A webhook posts every board event to a URL you own, signed so your endpoint can prove it came from here." />
        ) : (
          <ul className="grid gap-2">
            {webhooks.map((hook) => (
              <li
                key={hook.id}
                className="grid gap-2 rounded-lg border px-3 py-2 text-sm"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium" title={hook.url}>
                      {hook.url}
                      {!hook.active && (
                        <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground">
                          Paused
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {hook.events.length ? hook.events.join(", ") : "all events"}
                      {hook.lastStatus !== null && (
                        <span
                          className={
                            hook.lastStatus >= 200 && hook.lastStatus < 300
                              ? " text-primary"
                              : " text-destructive"
                          }
                        >
                          {" "}
                          · last delivery{" "}
                          {hook.lastStatus === 0 ? "failed" : hook.lastStatus}
                        </span>
                      )}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                    disabled={busy}
                    onClick={() =>
                      confirmingId === hook.id
                        ? remove(hook.id)
                        : setConfirmingId(hook.id)
                    }
                    onBlur={() => setConfirmingId(null)}
                  >
                    {confirmingId === hook.id ? "Really?" : "Delete"}
                  </Button>
                </div>
                <div className="flex flex-wrap gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground"
                    disabled={busy}
                    onClick={() => void togglePaused(hook)}
                  >
                    {hook.active ? "Pause" : "Resume"}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground"
                    disabled={busy}
                    onClick={() => void rotate(hook)}
                  >
                    Rotate secret
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground"
                    aria-expanded={showingLog === hook.id}
                    onClick={() => void toggleDeliveries(hook.id)}
                  >
                    {showingLog === hook.id ? "Hide deliveries" : "Deliveries"}
                  </Button>
                </div>
                {showingLog === hook.id && (
                  <div className="max-h-48 overflow-y-auto rounded border">
                    {deliveries.length === 0 ? (
                      <p className="p-2 text-xs text-muted-foreground">
                        Nothing delivered yet.
                      </p>
                    ) : (
                      <ul className="divide-y text-xs">
                        {deliveries.map((d) => (
                          <li
                            key={d.id}
                            className="flex items-baseline justify-between gap-2 px-2 py-1.5"
                          >
                            <span className="min-w-0 flex-1 truncate font-mono">
                              {d.action}
                            </span>
                            <span
                              className={
                                d.status === "delivered"
                                  ? "text-primary"
                                  : d.status === "failed"
                                    ? "text-destructive"
                                    : "text-muted-foreground"
                              }
                              title={d.lastError ?? undefined}
                            >
                              {d.status}
                              {d.attempts > 1 && ` · ${d.attempts} tries`}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        <div className="grid gap-2 border-t pt-3">
          <Label htmlFor="webhook-url">Endpoint URL</Label>
          <Input
            id="webhook-url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/hooks/kanban"
          />
          <Label htmlFor="webhook-events">Events (optional)</Label>
          <Input
            id="webhook-events"
            value={events}
            onChange={(e) => setEvents(e.target.value)}
            placeholder="task.created, task.moved — empty for all"
          />
          <div className="flex justify-end">
            <Button
              type="button"
              size="sm"
              disabled={busy || !url.trim()}
              onClick={create}
            >
              Add webhook
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
