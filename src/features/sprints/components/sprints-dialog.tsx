"use client";

import { useEffect, useMemo, useState } from "react";
import { Bot } from "lucide-react";

import type { AgentSummary } from "@/features/agents/types";
import type { Member } from "@/features/workspaces/types";
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
import * as api from "../client/api";
import {
  SPRINT_STATUS_LABELS,
  type Sprint,
  type SprintCapacityRow,
} from "../types";

interface SprintsDialogProps {
  boardId: number;
  open: boolean;
  canEdit: boolean;
  membersById: Record<string, Member>;
  agentsById: Record<string, AgentSummary>;
  onOpenChange: (open: boolean) => void;
  /** After any write — the board's sprint list and cards are now stale. */
  onChanged: () => void;
}

const STATUS_CLASS: Record<Sprint["status"], string> = {
  planning: "text-muted-foreground",
  active: "text-primary",
  completed: "text-muted-foreground line-through",
};

/**
 * The sprint planning surface (028). Lists the board's sprints with progress
 * and — the PRD payoff (§4.3) — each sprint's committed load broken down by
 * assignee, counting agents beside humans. Lifecycle lives here: Start a
 * planning sprint, Complete an active one (rolling its unfinished tasks to a
 * planning sprint or the backlog).
 */
export function SprintsDialog({
  boardId,
  open,
  canEdit,
  membersById,
  agentsById,
  onOpenChange,
  onChanged,
}: SprintsDialogProps) {
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [capacity, setCapacity] = useState<SprintCapacityRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  // Which active sprint is mid-complete (showing its rollover picker), and where
  // its unfinished work should go.
  const [completing, setCompleting] = useState<number | null>(null);
  const [rolloverTo, setRolloverTo] = useState<string>("");
  const [confirmingDelete, setConfirmingDelete] = useState<number | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await api.fetchSprints(boardId);
        if (cancelled) return;
        setSprints(data.sprints);
        setCapacity(data.capacity);
      } catch (e) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "Could not load sprints");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, boardId, version]);

  const capacityBySprint = useMemo(() => {
    const map = new Map<number, SprintCapacityRow[]>();
    for (const row of capacity) {
      const list = map.get(row.sprintId) ?? [];
      list.push(row);
      map.set(row.sprintId, list);
    }
    return map;
  }, [capacity]);

  const planningSprints = sprints.filter((s) => s.status === "planning");

  async function mutate(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      setVersion((v) => v + 1);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    const trimmed = name.trim();
    if (!trimmed) return;
    await mutate(async () => {
      await api.createSprint(
        boardId,
        trimmed,
        goal.trim(),
        startDate || null,
        endDate || null
      );
      setName("");
      setGoal("");
      setStartDate("");
      setEndDate("");
    });
  }

  function assigneeName(row: SprintCapacityRow): string {
    if (row.assigneeType === null || row.assigneeId === null)
      return "Unassigned";
    if (row.assigneeType === "agent")
      return agentsById[row.assigneeId]?.name ?? "An agent";
    return membersById[row.assigneeId]?.name ?? "A removed user";
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Sprints</DialogTitle>
          <DialogDescription>
            Timeboxed cycles. Capacity counts agents alongside people — the
            board’s work, however it gets done.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        {sprints.length === 0 ? (
          <p className="text-sm text-muted-foreground">No sprints yet.</p>
        ) : (
          <ul className="grid gap-3">
            {sprints.map((sprint) => {
              const rows = capacityBySprint.get(sprint.id) ?? [];
              const pct =
                sprint.points === 0
                  ? 0
                  : Math.round((sprint.donePoints / sprint.points) * 100);
              return (
                <li key={sprint.id} className="grid gap-2 rounded-lg border p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 text-sm font-medium">
                        <span className="truncate">{sprint.name}</span>
                        <span
                          className={`shrink-0 text-xs ${STATUS_CLASS[sprint.status]}`}
                        >
                          {SPRINT_STATUS_LABELS[sprint.status]}
                        </span>
                      </p>
                      {sprint.goal && (
                        <p className="truncate text-xs text-muted-foreground">
                          {sprint.goal}
                        </p>
                      )}
                      {(sprint.startDate || sprint.endDate) && (
                        <p className="text-xs text-muted-foreground tabular-nums">
                          {sprint.startDate ? formatDueDate(sprint.startDate) : "—"}
                          {" → "}
                          {sprint.endDate ? formatDueDate(sprint.endDate) : "—"}
                        </p>
                      )}
                    </div>
                    {canEdit && (
                      <div className="flex shrink-0 gap-1.5">
                        {sprint.status === "planning" && (
                          <Button
                            type="button"
                            size="sm"
                            disabled={busy}
                            onClick={() => mutate(() => api.startSprint(sprint.id))}
                          >
                            Start
                          </Button>
                        )}
                        {sprint.status === "active" && (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() => {
                              setCompleting(
                                completing === sprint.id ? null : sprint.id
                              );
                              setRolloverTo("");
                            }}
                          >
                            Complete
                          </Button>
                        )}
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="text-muted-foreground hover:text-destructive"
                          disabled={busy}
                          onClick={() =>
                            confirmingDelete === sprint.id
                              ? mutate(() => api.deleteSprint(sprint.id))
                              : setConfirmingDelete(sprint.id)
                          }
                          onBlur={() => setConfirmingDelete(null)}
                        >
                          {confirmingDelete === sprint.id ? "Really?" : "Delete"}
                        </Button>
                      </div>
                    )}
                  </div>

                  {/* The complete flow: choose where unfinished work rolls. */}
                  {completing === sprint.id && (
                    <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted/50 px-2 py-1.5 text-xs">
                      <span>Move unfinished tasks to</span>
                      <select
                        aria-label="Roll unfinished tasks to"
                        className="h-7 rounded-md border border-input bg-transparent px-2"
                        value={rolloverTo}
                        onChange={(e) => setRolloverTo(e.target.value)}
                      >
                        <option value="">Backlog</option>
                        {planningSprints.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                      <Button
                        type="button"
                        size="sm"
                        disabled={busy}
                        onClick={() =>
                          mutate(async () => {
                            await api.completeSprint(
                              sprint.id,
                              rolloverTo ? Number(rolloverTo) : null
                            );
                            setCompleting(null);
                          })
                        }
                      >
                        Complete sprint
                      </Button>
                    </div>
                  )}

                  {/* Progress in points — the number velocity and burndown will
                      read; the bar mirrors the milestone dialog's. */}
                  <div
                    className="h-1.5 overflow-hidden rounded-full bg-muted"
                    role="img"
                    aria-label={`${sprint.donePoints} of ${sprint.points} points done`}
                  >
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {sprint.done}/{sprint.total} tasks · {sprint.donePoints}/
                    {sprint.points} pts
                  </p>

                  {/* Capacity — agents beside people (§4.3). */}
                  {rows.length > 0 && (
                    <ul className="grid gap-0.5">
                      {rows.map((row) => (
                        <li
                          key={`${row.assigneeType}-${row.assigneeId}`}
                          className="flex items-center justify-between gap-2 text-xs"
                        >
                          <span className="flex items-center gap-1 text-muted-foreground">
                            {row.assigneeType === "agent" && (
                              <Bot className="size-3" aria-hidden="true" />
                            )}
                            {assigneeName(row)}
                          </span>
                          <span className="tabular-nums text-muted-foreground">
                            {row.count} · {row.points} pts
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {canEdit && (
          <div className="grid gap-2 border-t pt-3">
            <Label htmlFor="sprint-name">New sprint</Label>
            <Input
              id="sprint-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Sprint 1"
            />
            <Input
              aria-label="Sprint goal"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="Goal (optional)"
            />
            <div className="flex gap-2">
              <Input
                aria-label="Sprint start date"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
              <Input
                aria-label="Sprint end date"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
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
