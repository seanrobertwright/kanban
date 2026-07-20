"use client";

import { useState } from "react";

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
import type { Epic } from "../types";

interface EpicsDialogProps {
  boardId: number;
  open: boolean;
  /** Owned by the board (BoardData.epics); onChanged refetches them. */
  epics: Epic[];
  canEdit: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}

/**
 * The board's epics with their progress bars (031) — the roadmap one level above
 * the milestones. Creation and deletion are member-level: an epic delete un-files
 * its tasks and milestones, it destroys nothing (SET NULL).
 */
export function EpicsDialog({
  boardId,
  open,
  epics,
  canEdit,
  onOpenChange,
  onChanged,
}: EpicsDialogProps) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<number | null>(null);

  async function create() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      await api.createEpic(boardId, trimmed);
      setName("");
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the epic");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: number) {
    setBusy(true);
    setError(null);
    try {
      await api.deleteEpic(id);
      setConfirmingId(null);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete the epic");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Epics</DialogTitle>
          <DialogDescription>
            Larger-than-task groupings this board’s tasks and milestones roll up
            into. Progress counts tasks in the board’s done column.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        {epics.length === 0 ? (
          <p className="text-sm text-muted-foreground">No epics yet.</p>
        ) : (
          <ul className="grid gap-2">
            {epics.map((epic) => {
              const pct =
                epic.total === 0
                  ? 0
                  : Math.round((epic.done / epic.total) * 100);
              return (
                <li
                  key={epic.id}
                  className="grid gap-1 rounded-lg border px-3 py-2"
                >
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="min-w-0 truncate font-medium">
                      {epic.name}
                    </span>
                    {canEdit && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 shrink-0 px-1.5 text-xs text-muted-foreground hover:text-destructive"
                        disabled={busy}
                        onClick={() =>
                          confirmingId === epic.id
                            ? remove(epic.id)
                            : setConfirmingId(epic.id)
                        }
                        onBlur={() => setConfirmingId(null)}
                      >
                        {confirmingId === epic.id ? "Really?" : "Delete"}
                      </Button>
                    )}
                  </div>
                  {/* The bar and the words carry the same fact — the words are
                      for anyone who cannot judge a proportion by eye. */}
                  <div
                    className="h-1.5 overflow-hidden rounded-full bg-muted"
                    role="img"
                    aria-label={`${epic.done} of ${epic.total} tasks done`}
                  >
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {epic.done}/{epic.total} done
                  </p>
                </li>
              );
            })}
          </ul>
        )}

        {canEdit && (
          <div className="grid gap-2 border-t pt-3">
            <Label htmlFor="epic-name">New epic</Label>
            <div className="flex gap-2">
              <Input
                id="epic-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Billing"
              />
              <Button
                type="button"
                size="sm"
                disabled={busy || !name.trim()}
                onClick={create}
              >
                Add
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
