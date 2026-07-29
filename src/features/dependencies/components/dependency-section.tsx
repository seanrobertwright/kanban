"use client";

import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";

import { Button } from "@/shared/ui/button";
import * as api from "../client/api";
import {
  DEPENDENCY_TYPE_LABELS,
  DEPENDENCY_TYPES,
  isDependencyType,
  isLagDays,
  LAG_DAYS_MAX,
  LAG_DAYS_MIN,
  type DependencyLink,
  type TaskDependencyEntry,
  type TaskDependencyRef,
} from "../types";
import { Select, SelectItem } from "@/shared/ui/select";

interface DependencySectionProps {
  taskId: number;
  /** After any change — the parent card's blocked-by count is now stale. */
  onChanged?: () => void;
}

/**
 * One blocker: what it is, what the link to it means, and how far apart the two
 * ends sit (087).
 *
 * The lag is a draft until blur, which is the whole reason this is a component
 * rather than three elements inline. Typing "12" passes through "1", and a
 * request per keystroke would first tell the server the link is one day and then
 * that it is twelve — visible on a Gantt someone else is looking at. The type
 * select has no such intermediate state, so it commits on change.
 *
 * An empty or unparseable box reverts to what the server holds rather than
 * writing 0: clearing a field to retype it must not be read as "no lag".
 */
function DependencyRow({
  dep,
  onRelink,
  onRemove,
}: {
  dep: TaskDependencyEntry;
  onRelink: (link: DependencyLink) => void;
  onRemove: () => void;
}) {
  const [lagDraft, setLagDraft] = useState(String(dep.lagDays));

  // The row is not the owner of the truth — a refetch after any change can move
  // it underneath — so the draft re-syncs whenever the server's value moves.
  //
  // Adjusted during render against the last-seen prop, not in an effect. An
  // effect would paint the stale draft first and correct it on a second pass;
  // this discards the in-progress render and re-runs before anything reaches
  // the DOM. Keying the row on the lag would also work, but a remount drops
  // focus from whichever control just committed.
  const [lastSeenLag, setLastSeenLag] = useState(dep.lagDays);
  if (lastSeenLag !== dep.lagDays) {
    setLastSeenLag(dep.lagDays);
    setLagDraft(String(dep.lagDays));
  }

  function commitLag() {
    // Number("") is 0, not NaN — so an empty box would otherwise commit "no
    // lag" rather than reverting, and clearing the field to retype it would
    // silently rewrite the link.
    const parsed = lagDraft.trim() === "" ? NaN : Number(lagDraft);
    if (!isLagDays(parsed)) {
      setLagDraft(String(dep.lagDays));
      return;
    }
    if (parsed !== dep.lagDays) onRelink({ type: dep.type, lagDays: parsed });
  }

  return (
    <li className="flex items-center gap-1.5">
      <span className="min-w-0 flex-1 truncate text-sm">{dep.title}</span>
      <Select
        value={dep.type}
        aria-label={`Link type for "${dep.title}"`}
        onValueChange={(value) => {
          if (isDependencyType(value) && value !== dep.type)
            onRelink({ type: value, lagDays: dep.lagDays });
        }}
        className="w-32 shrink-0 py-0.5 text-xs dark:bg-input/30"
      >
        {DEPENDENCY_TYPES.map((type) => (
          <SelectItem key={type} value={type}>
            {DEPENDENCY_TYPE_LABELS[type]}
          </SelectItem>
        ))}
      </Select>
      {/* Days, signed: negative is a lead — this task starts before the blocker
          reaches the end the type names. */}
      <input
        type="number"
        inputMode="numeric"
        value={lagDraft}
        aria-label={`Lag in days for "${dep.title}"`}
        onChange={(event) => setLagDraft(event.target.value)}
        onBlur={commitLag}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
        min={LAG_DAYS_MIN}
        max={LAG_DAYS_MAX}
        className="h-6 w-14 shrink-0 rounded border bg-transparent px-1 text-right text-xs dark:bg-input/30"
      />
      <button
        type="button"
        aria-label={`Remove dependency on "${dep.title}"`}
        onClick={onRemove}
        className="shrink-0 rounded p-1 text-muted-foreground hover:text-destructive"
      >
        <X className="size-3.5" />
      </button>
    </li>
  );
}

/**
 * A task's "Blocked by" list, self-contained the way the checklist section is: it
 * fetches its own {dependencies, candidates} when mounted (the dialog mounts it
 * only for an existing, open task) and refetches the pair after every change,
 * because adding one blocker removes it from the candidate list and can prune
 * others the server now judges cyclic.
 *
 * Not optimistic, unlike the checklist. The server decides whether an edge is
 * legal — a cycle or a cross-board pick is refused — so the truthful thing to
 * show is the list the server returns, not a guess this component would have to
 * roll back. The refetch is cheap (a dialog is open, one task's edges) and the
 * server's refusal sentence is surfaced verbatim.
 */
export function DependencySection({
  taskId,
  onChanged,
}: DependencySectionProps) {
  const [dependencies, setDependencies] = useState<TaskDependencyEntry[]>([]);
  const [candidates, setCandidates] = useState<TaskDependencyRef[]>([]);
  const [choice, setChoice] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const next = await api.fetchDependencies(taskId);
        if (!active) return;
        setDependencies(next.dependencies);
        setCandidates(next.candidates);
      } catch {
        // Leave the lists empty if they cannot be read; the next open retries.
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [taskId]);

  async function reload() {
    try {
      const next = await api.fetchDependencies(taskId);
      setDependencies(next.dependencies);
      setCandidates(next.candidates);
    } catch {
      // keep what is on screen
    }
  }

  async function add() {
    const dependsOnId = Number(choice);
    if (!dependsOnId || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.addDependency(taskId, dependsOnId);
      setChoice("");
      await reload();
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add the dependency");
    } finally {
      setBusy(false);
    }
  }

  /**
   * Re-state an existing edge's link. The same POST the add uses — the server
   * upserts on the pair — so changing a type costs no second endpoint and no
   * delete-then-recreate, which would have flickered the edge out of existence
   * and briefly changed what the board is blocked on.
   */
  async function relink(dep: TaskDependencyEntry, link: DependencyLink) {
    setError(null);
    // Optimistic here, unlike the add: the server cannot refuse a link change on
    // a pair whose edge already exists — the cycle and same-board questions were
    // settled when it was created, and only the two columns move.
    setDependencies((prev) =>
      prev.map((d) => (d.id === dep.id ? { ...d, ...link } : d))
    );
    try {
      await api.addDependency(taskId, dep.id, link);
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not change the link");
      void reload();
    }
  }

  async function remove(dep: TaskDependencyRef) {
    setError(null);
    setDependencies((prev) => prev.filter((d) => d.id !== dep.id));
    try {
      await api.removeDependency(taskId, dep.id);
      await reload();
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove it");
      void reload();
    }
  }

  return (
    <div className="grid gap-2">
      <p className="text-xs font-medium text-muted-foreground">Blocked by</p>

      {dependencies.length > 0 && (
        <ul className="grid gap-1">
          {dependencies.map((dep) => (
            <DependencyRow
              key={dep.id}
              dep={dep}
              onRelink={(link) => relink(dep, link)}
              onRemove={() => remove(dep)}
            />
          ))}
        </ul>
      )}

      {candidates.length > 0 && (
        <div className="flex items-center gap-1.5">
          {/* A native select for the picker's reason in the dialog: one tab stop,
              announced as a listbox with no ARIA of ours, the platform picker on
              touch. Only same-board, non-cyclic tasks are offered — the server
              filters the options and refuses anything slipped past regardless. */}
          <Select
            value={choice}
            aria-label="Add a blocking task"
            onValueChange={(value) => setChoice(value)}
            className="w-full py-1 text-base md:text-sm dark:bg-input/30"
          >
            <SelectItem value="">Add a blocking task…</SelectItem>
            {candidates.map((task) => (
              <SelectItem key={task.id} value={String(task.id)}>
                {task.title}
              </SelectItem>
            ))}
          </Select>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-8 shrink-0"
            aria-label="Add dependency"
            disabled={!choice || busy}
            onClick={add}
          >
            <Plus />
          </Button>
        </div>
      )}

      {dependencies.length === 0 && candidates.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No other task on this board to depend on yet.
        </p>
      )}

      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
