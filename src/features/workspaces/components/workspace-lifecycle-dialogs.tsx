"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import * as api from "../client/api";
import type { WorkspaceMembership } from "../types";

interface LifecycleDialogProps {
  /** The workspace being acted on, or null when the dialog is closed. */
  workspace: WorkspaceMembership | null;
  onOpenChange: (open: boolean) => void;
  /** Called after the server accepted the change (refresh/navigate). */
  onDone: () => void;
}

/** Owner-only rename. The server enforces the gate; this is just the form. */
export function RenameWorkspaceDialog({
  workspace,
  onOpenChange,
  onDone,
}: LifecycleDialogProps) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wasFor, setWasFor] = useState<string | null>(null);

  // Seed the input on the render that opens the dialog (create-dialog's trick):
  // an effect would flash the previous value first.
  if ((workspace?.id ?? null) !== wasFor) {
    setWasFor(workspace?.id ?? null);
    if (workspace) {
      setName(workspace.name);
      setError(null);
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!workspace || !trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.renameWorkspace(workspace.id, trimmed);
      onOpenChange(false);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={workspace !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={handleSubmit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Rename workspace</DialogTitle>
            <DialogDescription>
              Renames {workspace?.name} for every member.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="rename-workspace-name">Workspace name</Label>
            <Input
              id="rename-workspace-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
              autoFocus
            />
          </div>
          {error && (
            <p
              role="alert"
              className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive"
            >
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !name.trim()}>
              {busy ? <Loader2 className="animate-spin" /> : "Rename"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Owner-only delete with typed confirmation: the workspace name must be typed
 * back exactly. Deletion cascades to every board, task, member, and invitation
 * — there is no undo, so the friction is the feature.
 */
export function DeleteWorkspaceDialog({
  workspace,
  onOpenChange,
  onDone,
}: LifecycleDialogProps) {
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wasFor, setWasFor] = useState<string | null>(null);

  if ((workspace?.id ?? null) !== wasFor) {
    setWasFor(workspace?.id ?? null);
    if (workspace) {
      setConfirm("");
      setError(null);
    }
  }

  const confirmed = workspace !== null && confirm === workspace.name;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!workspace || !confirmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.deleteWorkspace(workspace.id);
      onOpenChange(false);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={workspace !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={handleSubmit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Delete workspace</DialogTitle>
            <DialogDescription>
              Permanently deletes {workspace?.name} — every board, task, and
              membership in it. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="delete-workspace-confirm">
              Type <span className="font-semibold">{workspace?.name}</span> to
              confirm
            </Label>
            <Input
              id="delete-workspace-confirm"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder={workspace?.name}
              autoFocus
            />
          </div>
          {error && (
            <p
              role="alert"
              className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive"
            >
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={busy || !confirmed}>
              {busy ? <Loader2 className="animate-spin" /> : "Delete workspace"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
