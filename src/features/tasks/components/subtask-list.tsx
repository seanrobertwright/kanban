"use client";

import { useEffect, useState } from "react";
import { ChevronRight, Trash2 } from "lucide-react";

import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { createTask, deleteTask, fetchSubtasks } from "../client/api";
import { PriorityDot } from "./task-card";
import type { Task } from "../types";

interface SubtaskListProps {
  /** The task these pieces decompose. Every created piece points back at it. */
  parentId: number;
  /**
   * Where a new piece starts — the board's first column, because a subtask is
   * new work and new work enters at the front of the workflow, wherever the
   * parent itself happens to sit. Null when the board has no columns at all, and
   * the add form disables rather than posting a piece with nowhere to live.
   */
  defaultColumnId: number | null;
  /** Column titles by id, to show each piece's status the way the board does. */
  columnNames: Record<number, string>;
  /**
   * Open a piece in the same dialog. A subtask is a whole task, so it is edited
   * by the task editor rather than a second one — the parent lifts this to the
   * board, which owns the dialog and the navigation back.
   */
  onOpenSubtask: (task: Task) => void;
  /**
   * After a piece is added or removed. The parent's `subtaskCount` is a fact
   * about these rows, so the card that shows it is now stale — the board is what
   * re-reads it. This does not fire on opening a piece: that changes nothing.
   */
  onChanged?: () => void;
}

/**
 * A task's pieces, listed inside its dialog — the only place they appear, since
 * the board renders top-level tasks alone (008). The shape is CommentThread's,
 * and for the same reasons: it fetches on open rather than riding along on the
 * board, it owns its own create/delete against the API, and it refetches rather
 * than patching a row it would otherwise have to reconstruct the server's rules
 * to build.
 *
 * What it deliberately does *not* do is edit a piece's own fields. A subtask is a
 * whole task — status, assignee, priority, labels, comments — and the one surface
 * that already knows how to edit all of that is the task dialog. So a row opens
 * the piece there rather than growing a second, thinner editor beside it.
 */
export function SubtaskList({
  parentId,
  defaultColumnId,
  columnNames,
  onOpenSubtask,
  onChanged,
}: SubtaskListProps) {
  const [subtasks, setSubtasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  // Two clicks to delete, not a confirm() — a modal inside a modal, blocking the
  // whole page. Until M2 ships undo, the second click is the only thing between a
  // slip and a lost piece. CommentThread's pattern exactly.
  const [confirmingId, setConfirmingId] = useState<number | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchSubtasks(parentId);
        if (cancelled) return;
        setSubtasks(data);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load subtasks");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [parentId, version]);

  async function mutate(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      setVersion((v) => v + 1);
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function add() {
    const title = draft.trim();
    if (!title || defaultColumnId == null) return;
    await mutate(async () => {
      // A subtask is a task, so this is createTask with a parentId — there is no
      // second create path to keep in step (see fetchSubtasks). The server proves
      // the parent is on this board and is not itself a piece.
      await createTask({ columnId: defaultColumnId, title, parentId });
      setDraft("");
    });
  }

  return (
    <div className="grid gap-3">
      <p className="text-xs font-medium text-muted-foreground">
        Subtasks{subtasks.length > 0 && ` (${subtasks.length})`}
      </p>

      {loading && subtasks.length === 0 && (
        <p className="text-xs text-muted-foreground">Loading subtasks…</p>
      )}

      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}

      {!loading && subtasks.length === 0 && (
        <p className="text-xs text-muted-foreground">No subtasks yet.</p>
      )}

      {subtasks.length > 0 && (
        <ul className="grid gap-1">
          {subtasks.map((subtask) => (
            <li key={subtask.id} className="flex items-center gap-1">
              {/* The row opens the piece; the whole task editor takes it from
                  there. A button, not a link — it changes app state, not the
                  URL — and the chevron says it leads somewhere. */}
              <button
                type="button"
                onClick={() => onOpenSubtask(subtask)}
                className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-sm hover:bg-accent hover:text-accent-foreground"
              >
                <PriorityDot priority={subtask.priority} />
                <span className="min-w-0 flex-1 truncate">{subtask.title}</span>
                {/* The piece's status, the way the board shows it — a piece flows
                    through the workflow independently of the thing it decomposes,
                    so "which column" is the fact worth surfacing here. */}
                <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {columnNames[subtask.columnId] ?? "—"}
                </span>
                <ChevronRight
                  className="size-3.5 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
              </button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={`size-7 shrink-0 ${
                  confirmingId === subtask.id
                    ? "text-destructive"
                    : "text-muted-foreground"
                }`}
                disabled={busy}
                aria-label={
                  confirmingId === subtask.id
                    ? `Confirm delete ${subtask.title}`
                    : `Delete ${subtask.title}`
                }
                title={confirmingId === subtask.id ? "Really?" : "Delete"}
                onClick={() =>
                  confirmingId === subtask.id
                    ? mutate(() => deleteTask(subtask.id))
                    : setConfirmingId(subtask.id)
                }
                onBlur={() => setConfirmingId(null)}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {/* Not a <form>: this sits inside the dialog's task form, and a nested one
          is invalid HTML. The button is type="button" and Enter is handled by
          hand for the same reason — the form's default submit would save the
          parent task instead of adding a piece. */}
      <div className="flex gap-1.5">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add a subtask…"
          aria-label="New subtask title"
          className="h-8"
          disabled={defaultColumnId == null}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void add();
            }
          }}
        />
        <Button
          type="button"
          size="sm"
          disabled={busy || !draft.trim() || defaultColumnId == null}
          onClick={add}
        >
          Add
        </Button>
      </div>
    </div>
  );
}
