"use client";

import { useState } from "react";

import { formatDueDate } from "@/shared/lib/due-date";
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
import type { Epic } from "@/features/epics/types";
import type { Objective } from "@/features/objectives/types";
import * as api from "../client/api";
import type { Milestone } from "../types";

interface MilestonesDialogProps {
  boardId: number;
  open: boolean;
  /** Owned by the board (BoardData.milestones); onChanged refetches them. */
  milestones: Milestone[];
  /** The board's epics (031), the "file under" picker's options and the source
   *  for a milestone row's epic name. Empty renders no picker. */
  epics: Epic[];
  /** The board's objectives (037), the "aim at" picker's options and the source
   *  for a milestone row's objective name. Empty renders no picker. */
  objectives: Objective[];
  canEdit: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}

/**
 * The board's milestones with their progress bars (026) — the roadmap-at-a-
 * glance the entity exists for. Creation and deletion are member-level: a
 * milestone delete un-aims tasks, it destroys nothing (SET NULL).
 */
export function MilestonesDialog({
  boardId,
  open,
  milestones,
  epics,
  objectives,
  canEdit,
  onOpenChange,
  onChanged,
}: MilestonesDialogProps) {
  const [name, setName] = useState("");
  const [dueDate, setDueDate] = useState("");
  // "" is "no epic" — the <option> stand-in for null (031).
  const [epicId, setEpicId] = useState("");
  // "" is "no objective" — the <option> stand-in for null (037).
  const [objectiveId, setObjectiveId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<number | null>(null);

  const epicName = new Map(epics.map((e) => [e.id, e.name]));
  const objectiveName = new Map(objectives.map((o) => [o.id, o.name]));

  async function create() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      await api.createMilestone(
        boardId,
        trimmed,
        dueDate || null,
        epicId === "" ? null : Number(epicId),
        objectiveId === "" ? null : Number(objectiveId)
      );
      setName("");
      setDueDate("");
      setEpicId("");
      setObjectiveId("");
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the milestone");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: number) {
    setBusy(true);
    setError(null);
    try {
      await api.deleteMilestone(id);
      setConfirmingId(null);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete the milestone");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Milestones</DialogTitle>
          <DialogDescription>
            Named checkpoints this board’s tasks aim at. Progress counts tasks
            in the board’s done column.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        {milestones.length === 0 ? (
          <p className="text-sm text-muted-foreground">No milestones yet.</p>
        ) : (
          <ul className="grid gap-2">
            {milestones.map((milestone) => {
              const pct =
                milestone.total === 0
                  ? 0
                  : Math.round((milestone.done / milestone.total) * 100);
              return (
                <li
                  key={milestone.id}
                  className="grid gap-1 rounded-lg border px-3 py-2"
                >
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="min-w-0 truncate font-medium">
                        {milestone.name}
                      </span>
                      {/* The epic it rolls up into (031), when filed. A muted
                          chip so the hierarchy reads without competing with the
                          milestone's own name. */}
                      {milestone.epicId != null &&
                        epicName.has(milestone.epicId) && (
                          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                            {epicName.get(milestone.epicId)}
                          </span>
                        )}
                      {/* The objective it aims at (037), when linked — an outline
                          chip so it reads apart from the epic's filled one. */}
                      {milestone.objectiveId != null &&
                        objectiveName.has(milestone.objectiveId) && (
                          <span className="shrink-0 rounded border px-1.5 py-0.5 text-xs text-muted-foreground">
                            {objectiveName.get(milestone.objectiveId)}
                          </span>
                        )}
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      {milestone.dueDate && (
                        <time
                          dateTime={milestone.dueDate}
                          className="text-xs text-muted-foreground tabular-nums"
                        >
                          {formatDueDate(milestone.dueDate)}
                        </time>
                      )}
                      {canEdit && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-6 px-1.5 text-xs text-muted-foreground hover:text-destructive"
                          disabled={busy}
                          onClick={() =>
                            confirmingId === milestone.id
                              ? remove(milestone.id)
                              : setConfirmingId(milestone.id)
                          }
                          onBlur={() => setConfirmingId(null)}
                        >
                          {confirmingId === milestone.id ? "Really?" : "Delete"}
                        </Button>
                      )}
                    </span>
                  </div>
                  {/* The bar and the words carry the same fact — the words are
                      for anyone who cannot judge a proportion by eye. */}
                  <div
                    className="h-1.5 overflow-hidden rounded-full bg-muted"
                    role="img"
                    aria-label={`${milestone.done} of ${milestone.total} tasks done`}
                  >
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {milestone.done}/{milestone.total} done
                  </p>
                </li>
              );
            })}
          </ul>
        )}

        {canEdit && (
          <div className="grid gap-2 border-t pt-3">
            <Label htmlFor="milestone-name">New milestone</Label>
            <div className="flex gap-2">
              <Input
                id="milestone-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="v1.0"
              />
              <Input
                aria-label="Milestone due date"
                type="date"
                className="w-36 shrink-0"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
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
            {/* File the new milestone under an epic (031). Only when the board
                has any — the picker is absent otherwise, so a board with no
                epics shows the form exactly as before. */}
            {epics.length > 0 && (
              <select
                aria-label="Epic"
                value={epicId}
                onChange={(e) => setEpicId(e.target.value)}
                className="h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30"
              >
                <option value="">No epic</option>
                {epics.map((epic) => (
                  <option key={epic.id} value={epic.id}>
                    {epic.name}
                  </option>
                ))}
              </select>
            )}
            {/* Aim the new milestone at an objective (037). Epic's rule: only
                when the board has any. */}
            {objectives.length > 0 && (
              <select
                aria-label="Objective"
                value={objectiveId}
                onChange={(e) => setObjectiveId(e.target.value)}
                className="h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30"
              >
                <option value="">No objective</option>
                {objectives.map((objective) => (
                  <option key={objective.id} value={objective.id}>
                    {objective.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
