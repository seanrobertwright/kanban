"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";

import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Label as FieldLabel } from "@/shared/ui/label";
import * as labelsApi from "../client/api";
import { labelDotClass } from "./label-chip";
import { LABEL_COLORS, LABEL_NAME_MAX } from "../types";
import type { Label, LabelColor } from "../types";

interface LabelsDialogProps {
  open: boolean;
  workspaceId: string;
  labels: Label[];
  /** False for viewers, who may read the vocabulary but not change it. */
  canEdit: boolean;
  /** Admin and up — deleting reaches every task wearing the label (§7.4). */
  canDelete: boolean;
  onOpenChange: (open: boolean) => void;
  /** The vocabulary changed; the board re-reads it and its tasks. */
  onChanged: (labels: Label[]) => void;
}

/**
 * Where the vocabulary is managed — and the only place it can be.
 *
 * Deliberately not reachable from the task dialog. A label created in passing
 * while editing a task is how a controlled set rots back into free text: the
 * whole value of 007 is that choosing is easy and minting is a decision someone
 * makes on purpose, looking at the list they already have.
 */
export function LabelsDialog({
  open,
  workspaceId,
  labels,
  canEdit,
  canDelete,
  onOpenChange,
  onChanged,
}: LabelsDialogProps) {
  const [name, setName] = useState("");
  const [color, setColor] = useState<LabelColor>("slate");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    onChanged(await labelsApi.fetchLabels(workspaceId));
  }

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await reload();
    } catch (e) {
      // The server's sentence, not a generic one: "already has a label called
      // Regression" is the whole answer, and it already names the label in the
      // case it was created with so the reader can go and find it.
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    await run(async () => {
      await labelsApi.createLabel(workspaceId, { name: name.trim(), color });
      setName("");
      setColor("slate");
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Labels</DialogTitle>
          <DialogDescription>
            The vocabulary for this workspace. Every board shares it.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}

        <ul className="grid max-h-64 gap-1 overflow-y-auto">
          {labels.length === 0 && (
            <li className="py-2 text-xs text-muted-foreground">
              No labels yet.
            </li>
          )}
          {labels.map((label) => (
            <li key={label.id} className="flex items-center gap-2">
              <span
                className={`size-2.5 shrink-0 rounded-full ${labelDotClass(label.color)}`}
                aria-hidden="true"
              />
              <span className="flex-1 truncate text-sm">{label.name}</span>
              {canDelete && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 text-muted-foreground"
                  disabled={busy}
                  aria-label={`Delete ${label.name}`}
                  onClick={() => run(() => labelsApi.deleteLabel(label.id))}
                >
                  <Trash2 />
                </Button>
              )}
            </li>
          ))}
        </ul>

        {canEdit && (
          <form onSubmit={handleCreate} className="grid gap-2 border-t pt-3">
            <FieldLabel htmlFor="label-name">New label</FieldLabel>
            <div className="flex items-center gap-2">
              <Input
                id="label-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="bug"
                maxLength={LABEL_NAME_MAX}
              />
              {/* Radio-shaped, because a colour is one choice from a closed
                  palette and there are seven of them — a select would hide the
                  thing being chosen behind its own name. */}
              <div
                role="radiogroup"
                aria-label="Label colour"
                className="flex shrink-0 items-center gap-1"
              >
                {LABEL_COLORS.map((value) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={color === value}
                    aria-label={value}
                    onClick={() => setColor(value)}
                    className={`size-4 rounded-full ${labelDotClass(value)} ${
                      color === value
                        ? "ring-2 ring-ring ring-offset-1 ring-offset-background"
                        : ""
                    }`}
                  />
                ))}
              </div>
            </div>
            <Button
              type="submit"
              size="sm"
              disabled={busy || !name.trim()}
              className="justify-self-start"
            >
              Add label
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
