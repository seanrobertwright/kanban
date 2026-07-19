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
import type { Webhook } from "../types";

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
          <p className="text-sm text-muted-foreground">No webhooks yet.</p>
        ) : (
          <ul className="grid gap-2">
            {webhooks.map((hook) => (
              <li
                key={hook.id}
                className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium" title={hook.url}>
                    {hook.url}
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
