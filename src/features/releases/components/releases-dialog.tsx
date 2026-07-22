"use client";

import { useCallback, useEffect, useState } from "react";

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
import type { Release } from "../types";

interface ReleasesDialogProps {
  boardId: number;
  open: boolean;
  /** Board tasks for the assignment picker ({id,title}); a release gathers these. */
  tasks: { id: number; title: string }[];
  canEdit: boolean;
  onOpenChange: (open: boolean) => void;
  /** Refetch the board — a shipped release may have fired a rule. */
  onChanged: () => void;
}

/**
 * The board's releases (2.8) — versions its work ships under, self-fetching in the
 * Timesheet/Forms shape (not on BoardData). A release shows its progress, its
 * planned/released state, and the tasks it carries; a git tag ships it
 * automatically, or a member ships it by hand. Deliberately its own surface rather
 * than a task-dialog field: a release is a delivery grouping, managed here.
 */
export function ReleasesDialog({
  boardId,
  open,
  tasks,
  canEdit,
  onOpenChange,
  onChanged,
}: ReleasesDialogProps) {
  const [releases, setReleases] = useState<Release[] | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      setReleases(await api.fetchReleases(boardId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load releases");
    }
  }, [boardId]);

  // Load on open — setState rides the fetch callback (not the effect body) so the
  // effect only subscribes, and a close/reopen race cannot land a stale list.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    api
      .fetchReleases(boardId)
      .then((r) => {
        if (!cancelled) setReleases(r);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load releases");
      });
    return () => {
      cancelled = true;
    };
  }, [open, boardId]);

  async function run(fn: () => Promise<unknown>, fail: string) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : fail);
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    const trimmed = name.trim();
    if (!trimmed) return;
    await run(async () => {
      await api.createRelease(boardId, trimmed);
      setName("");
    }, "Could not create the release");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Releases</DialogTitle>
          <DialogDescription>
            Versions this board’s work ships under. A matching git tag ships a
            release automatically; progress counts tasks in the done column.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        {!releases ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : releases.length === 0 ? (
          <p className="text-sm text-muted-foreground">No releases yet.</p>
        ) : (
          <ul className="grid gap-2">
            {releases.map((release) => (
              <ReleaseRow
                key={release.id}
                release={release}
                tasks={tasks}
                canEdit={canEdit}
                busy={busy}
                expanded={expanded === release.id}
                onToggle={() =>
                  setExpanded(expanded === release.id ? null : release.id)
                }
                onShip={() =>
                  run(
                    () => api.updateRelease(release.id, { state: "released" }),
                    "Could not ship the release"
                  )
                }
                onDelete={() =>
                  run(() => api.deleteRelease(release.id), "Could not delete the release")
                }
                onAssign={(taskId, assign) =>
                  run(
                    () => api.setTaskRelease(release.id, taskId, assign),
                    "Could not update the assignment"
                  )
                }
              />
            ))}
          </ul>
        )}

        {canEdit && (
          <div className="flex gap-2 border-t pt-3">
            <Label htmlFor="release-name" className="sr-only">
              New release
            </Label>
            <Input
              id="release-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="v1.2.0"
            />
            <Button type="button" size="sm" disabled={busy || !name.trim()} onClick={create}>
              Add
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ReleaseRow({
  release,
  tasks,
  canEdit,
  busy,
  expanded,
  onToggle,
  onShip,
  onDelete,
  onAssign,
}: {
  release: Release;
  tasks: { id: number; title: string }[];
  canEdit: boolean;
  busy: boolean;
  expanded: boolean;
  onToggle: () => void;
  onShip: () => void;
  onDelete: () => void;
  onAssign: (taskId: number, assign: boolean) => void;
}) {
  const [members, setMembers] = useState<{ id: number; title: string }[] | null>(null);
  const [confirming, setConfirming] = useState(false);
  const pct = release.total === 0 ? 0 : Math.round((release.done / release.total) * 100);

  useEffect(() => {
    if (expanded) api.fetchReleaseTasks(release.id).then(setMembers).catch(() => setMembers([]));
  }, [expanded, release.id]);

  const memberIds = new Set((members ?? []).map((m) => m.id));
  const assignable = tasks.filter((t) => !memberIds.has(t.id));

  return (
    <li className="grid gap-1 rounded-lg border px-3 py-2">
      <div className="flex items-center justify-between gap-2 text-sm">
        <button
          type="button"
          onClick={onToggle}
          className="flex min-w-0 items-center gap-2 text-left"
        >
          <span className="min-w-0 truncate font-medium">{release.name}</span>
          <span
            className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium capitalize ${
              release.state === "released"
                ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                : "bg-muted text-muted-foreground"
            }`}
          >
            {release.state}
          </span>
        </button>
        {canEdit && (
          <span className="flex shrink-0 items-center gap-1">
            {release.state === "planned" && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 px-1.5 text-xs"
                disabled={busy}
                onClick={onShip}
              >
                Ship
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 px-1.5 text-xs text-muted-foreground hover:text-destructive"
              disabled={busy}
              onClick={() => (confirming ? onDelete() : setConfirming(true))}
              onBlur={() => setConfirming(false)}
            >
              {confirming ? "Really?" : "Delete"}
            </Button>
          </span>
        )}
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={`${release.done} of ${release.total} tasks done`}
      >
        <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
      <p className="text-xs text-muted-foreground tabular-nums">
        {release.done}/{release.total} done
      </p>

      {expanded && (
        <div className="mt-1 grid gap-1 border-t pt-2">
          {(members ?? []).map((m) => (
            <div key={m.id} className="flex items-center justify-between gap-2 text-xs">
              <span className="min-w-0 truncate">{m.title}</span>
              {canEdit && (
                <button
                  type="button"
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                  disabled={busy}
                  onClick={() => onAssign(m.id, false)}
                >
                  Remove
                </button>
              )}
            </div>
          ))}
          {members && members.length === 0 && (
            <p className="text-xs text-muted-foreground">No tasks in this release.</p>
          )}
          {canEdit && assignable.length > 0 && (
            <select
              aria-label="Add a task to this release"
              value=""
              disabled={busy}
              onChange={(e) => e.target.value && onAssign(Number(e.target.value), true)}
              className="mt-1 h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
            >
              <option value="">Add a task…</option>
              {assignable.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
          )}
        </div>
      )}
    </li>
  );
}
