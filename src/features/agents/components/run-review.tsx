"use client";

import { useCallback, useEffect, useState } from "react";

import { Button } from "@/shared/ui/button";
import {
  latestRunForTask,
  reviewChangeset,
  revertAction,
} from "../client/api";
import type { AgentActionView, RunDetail } from "../types";

/**
 * §7.4's changeset review, in the task dialog: "a pull request for the board".
 * When a native agent has worked this task, this shows what it did — the auto
 * actions it already took (each undoable within the window) and the consequential
 * ones it PROPOSED, held for the human to accept all / some / none in one pass.
 * That batching is the whole point: twenty proposals are one review, not twenty
 * interrupts (§7.4, acceptance #2).
 */

// The auto-tier actions whose inverse is "restore what the field was" — the ones
// revertAction can undo (comments and claims are not board-state, so no button).
const UNDOABLE = new Set([
  "set_priority",
  "set_labels",
  "set_due_date",
  "rename_task",
]);

const STATUS_LABEL: Record<string, string> = {
  queued: "queued",
  running: "working…",
  awaiting_review: "awaiting your review",
  succeeded: "done",
  failed: "failed",
  halted: "halted — budget cap reached",
};

function describe(a: AgentActionView): string {
  const i = (a.input ?? {}) as Record<string, unknown>;
  switch (a.tool) {
    case "set_priority":
      return `Set priority to ${i.priority}`;
    case "set_due_date":
      return i.dueDate ? `Set due date to ${i.dueDate}` : "Cleared the due date";
    case "set_labels":
      return "Set labels";
    case "rename_task":
      return "Edited the title/description";
    case "comment_on_task":
      return "Commented";
    case "claim_task":
      return "Claimed the task";
    case "release_task":
      return "Released the task";
    case "move_task":
      return `Move to column ${i.columnId}`;
    case "assign_task": {
      const who = i.assignee as { type: string; id: string } | null;
      return who ? `Assign to ${who.type} ${who.id}` : "Unassign";
    }
    case "create_task":
      return `Create task "${i.title}"`;
    case "create_subtask":
      return `Create subtask "${i.title}"`;
    default:
      return a.tool;
  }
}

export function RunReview({
  taskId,
  onChanged,
}: {
  taskId: number;
  /** Fired after an accept or undo, so the dialog can refresh the feed/board. */
  onChanged?: () => void;
}) {
  const [detail, setDetail] = useState<RunDetail | null | undefined>(undefined);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    latestRunForTask(taskId)
      .then((d) => {
        setDetail(d);
        // Default every proposed action checked — accepting the agent's work is
        // the common case, and unchecking is how you reject one.
        if (d?.changeset?.status === "pending") {
          const next: Record<string, boolean> = {};
          for (const a of d.actions) if (a.tier === "changeset") next[a.id] = true;
          setChecked(next);
        }
      })
      .catch((e: Error) => setError(e.message));
  }, [taskId]);

  useEffect(() => {
    setDetail(undefined);
    setError(null);
    load();
  }, [load]);

  if (!detail) return null; // undefined (loading) or null (no run) → show nothing.

  const autos = detail.actions.filter((a) => a.tier === "auto");
  const proposed = detail.actions.filter((a) => a.tier === "changeset");
  const pending = detail.changeset?.status === "pending";

  async function withBusy(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChanged?.();
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const accept = (ids: string[]) =>
    withBusy(async () => {
      if (detail?.changeset) await reviewChangeset(detail.changeset.id, ids);
    });

  return (
    <div className="grid gap-2">
      <p className="text-xs font-medium text-muted-foreground">
        Agent run — {STATUS_LABEL[detail.status] ?? detail.status}
      </p>

      {autos.length > 0 && (
        <ul className="grid gap-1 text-xs">
          {autos.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-2">
              <span
                className={a.revertedAt ? "text-muted-foreground line-through" : ""}
              >
                {describe(a)}
              </span>
              {UNDOABLE.has(a.tool) &&
                (a.revertedAt ? (
                  <span className="text-muted-foreground">undone</span>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    disabled={busy}
                    onClick={() => withBusy(() => revertAction(a.id))}
                  >
                    Undo
                  </Button>
                ))}
            </li>
          ))}
        </ul>
      )}

      {pending && proposed.length > 0 && (
        <div className="grid gap-2 rounded-lg border p-2">
          <p className="text-xs font-medium">Proposed changes — accept or reject</p>
          <ul className="grid gap-1 text-xs">
            {proposed.map((a) => (
              <li key={a.id} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={checked[a.id] ?? false}
                  onChange={(e) =>
                    setChecked((c) => ({ ...c, [a.id]: e.target.checked }))
                  }
                  disabled={busy}
                />
                <span>{describe(a)}</span>
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              disabled={busy}
              onClick={() =>
                accept(proposed.filter((a) => checked[a.id]).map((a) => a.id))
              }
            >
              Accept selected
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => accept([])}
            >
              Reject all
            </Button>
          </div>
        </div>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
