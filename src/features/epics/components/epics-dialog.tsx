"use client";

import { Layers } from "lucide-react";
import { EmptyState } from "@/shared/ui/empty-state";
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
import { Select, SelectItem } from "@/shared/ui/select";
import type { Member } from "@/features/workspaces/types";
import * as api from "../client/api";
import {
  EPIC_STATUSES,
  EPIC_STATUS_LABELS,
  type Epic,
  type EpicStatus,
} from "../types";

interface EpicsDialogProps {
  boardId: number;
  open: boolean;
  /** Owned by the board (BoardData.epics); onChanged refetches them. */
  epics: Epic[];
  /** The owner picker's options — the same roster the assignee picker draws. */
  members: Member[];
  canEdit: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}

/**
 * The board's epics with their progress bars (031) — the roadmap one level above
 * the milestones. Creation and deletion are member-level: an epic delete un-files
 * its tasks and milestones, it destroys nothing (SET NULL).
 *
 * 089 gives each row the two facts an epic could not previously state — where it
 * stands and whose it is — and the window its contents describe. Status and
 * owner commit on change rather than behind a Save: they are single-value edits
 * the server treats as idempotent, and a form that needs saving is how a status
 * change gets lost. The name is the exception, because a half-typed name is not
 * a name — it keeps an explicit Rename/Save, which is also the first UI the
 * PATCH route has had since 031 (the client function did not exist; renaming an
 * epic meant curl).
 */
export function EpicsDialog({
  boardId,
  open,
  epics,
  members,
  canEdit,
  onOpenChange,
  onChanged,
}: EpicsDialogProps) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<number | null>(null);
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [draftName, setDraftName] = useState("");

  /** One busy/error wrapper for every write — they all end in a refetch. */
  async function run(action: () => Promise<unknown>, failure: string) {
    setBusy(true);
    setError(null);
    try {
      await action();
      onChanged();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : failure);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    const trimmed = name.trim();
    if (!trimmed) return;
    const ok = await run(
      () => api.createEpic(boardId, trimmed),
      "Could not create the epic"
    );
    if (ok) setName("");
  }

  async function saveName(id: number) {
    const trimmed = draftName.trim();
    if (!trimmed) return;
    const ok = await run(
      () => api.updateEpic(id, { name: trimmed }),
      "Could not rename the epic"
    );
    if (ok) setRenamingId(null);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Epics</DialogTitle>
          <DialogDescription>
            Larger-than-task groupings this board’s tasks and milestones roll up
            into. Progress counts tasks in the board’s done column, and the dates
            are read from the work inside — an epic has none of its own.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        {epics.length === 0 ? (
          <EmptyState icon={Layers} title="No epics yet" hint="An epic groups a body of work one level above a milestone. Tasks and milestones file under it, and its window is read from the work inside." />
        ) : (
          <ul className="grid gap-2">
            {epics.map((epic) => {
              const pct =
                epic.total === 0
                  ? 0
                  : Math.round((epic.done / epic.total) * 100);
              const renaming = renamingId === epic.id;
              return (
                <li
                  key={epic.id}
                  className="grid gap-1.5 rounded-lg border px-3 py-2"
                >
                  <div className="flex items-center justify-between gap-2 text-sm">
                    {renaming ? (
                      <Input
                        autoFocus
                        aria-label={`Rename ${epic.name}`}
                        className="h-7"
                        value={draftName}
                        disabled={busy}
                        onChange={(e) => setDraftName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void saveName(epic.id);
                          if (e.key === "Escape") setRenamingId(null);
                        }}
                      />
                    ) : (
                      <span className="min-w-0 truncate font-medium">
                        {epic.name}
                      </span>
                    )}
                    {canEdit && (
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-6 px-1.5 text-xs text-muted-foreground"
                          disabled={busy || (renaming && !draftName.trim())}
                          onClick={() => {
                            if (renaming) return void saveName(epic.id);
                            setDraftName(epic.name);
                            setRenamingId(epic.id);
                          }}
                        >
                          {renaming ? "Save" : "Rename"}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-6 px-1.5 text-xs text-muted-foreground hover:text-destructive"
                          disabled={busy}
                          onClick={() =>
                            confirmingId === epic.id
                              ? void run(
                                  () =>
                                    api
                                      .deleteEpic(epic.id)
                                      .then(() => setConfirmingId(null)),
                                  "Could not delete the epic"
                                )
                              : setConfirmingId(epic.id)
                          }
                          onBlur={() => setConfirmingId(null)}
                        >
                          {confirmingId === epic.id ? "Really?" : "Delete"}
                        </Button>
                      </div>
                    )}
                  </div>

                  {/* Status and owner: the two facts about the bucket itself. */}
                  {canEdit ? (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Select
                        aria-label={`Status of ${epic.name}`}
                        className="h-7 rounded-md px-2 text-xs"
                        value={epic.status}
                        onValueChange={(value) =>
                          void run(
                            () =>
                              api.updateEpic(epic.id, {
                                status: value as EpicStatus,
                              }),
                            "Could not set the status"
                          )
                        }
                      >
                        {EPIC_STATUSES.map((s) => (
                          <SelectItem key={s} value={s}>
                            {EPIC_STATUS_LABELS[s]}
                          </SelectItem>
                        ))}
                      </Select>
                      <Select
                        aria-label={`Owner of ${epic.name}`}
                        className="h-7 rounded-md px-2 text-xs"
                        value={epic.ownerId ?? ""}
                        onValueChange={(value) =>
                          void run(
                            // "" is the un-own option: the wire is three-valued,
                            // and an explicit null is what clears the owner.
                            () =>
                              api.updateEpic(epic.id, {
                                ownerId: value === "" ? null : String(value),
                              }),
                            "Could not set the owner"
                          )
                        }
                      >
                        <SelectItem value="">Unowned</SelectItem>
                        {members.map((m) => (
                          <SelectItem key={m.userId} value={m.userId}>
                            {m.name}
                          </SelectItem>
                        ))}
                      </Select>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      {EPIC_STATUS_LABELS[epic.status]}
                      {epic.ownerName ? ` · ${epic.ownerName}` : ""}
                    </p>
                  )}

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
                    {/* Either end can be missing — a started-but-undated epic
                        has a target and no start, and vice versa — so each is
                        rendered on its own rather than as one range string. */}
                    {epic.startDate && ` · from ${formatDueDate(epic.startDate)}`}
                    {epic.targetDate && ` · to ${formatDueDate(epic.targetDate)}`}
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
