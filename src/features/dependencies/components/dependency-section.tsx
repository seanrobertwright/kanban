"use client";

import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";

import { Button } from "@/shared/ui/button";
import * as api from "../client/api";
import type { TaskDependencyRef } from "../types";

interface DependencySectionProps {
  taskId: number;
  /** After any change — the parent card's blocked-by count is now stale. */
  onChanged?: () => void;
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
  const [dependencies, setDependencies] = useState<TaskDependencyRef[]>([]);
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
            <li key={dep.id} className="flex items-center gap-2">
              <span className="flex-1 truncate text-sm">{dep.title}</span>
              <button
                type="button"
                aria-label={`Remove dependency on "${dep.title}"`}
                onClick={() => remove(dep)}
                className="shrink-0 rounded p-1 text-muted-foreground hover:text-destructive"
              >
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {candidates.length > 0 && (
        <div className="flex items-center gap-1.5">
          {/* A native select for the picker's reason in the dialog: one tab stop,
              announced as a listbox with no ARIA of ours, the platform picker on
              touch. Only same-board, non-cyclic tasks are offered — the server
              filters the options and refuses anything slipped past regardless. */}
          <select
            value={choice}
            aria-label="Add a blocking task"
            onChange={(e) => setChoice(e.target.value)}
            className="h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30"
          >
            <option value="">Add a blocking task…</option>
            {candidates.map((task) => (
              <option key={task.id} value={task.id}>
                {task.title}
              </option>
            ))}
          </select>
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
