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
import type { KeyResult, Objective } from "../types";

interface ObjectivesDialogProps {
  boardId: number;
  open: boolean;
  /** Owned by the board (BoardData.objectives); onChanged refetches them. */
  objectives: Objective[];
  canEdit: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}

const pct = (fraction: number) => Math.round(fraction * 100);

/** A KR's numbers as a compact "6 / 4 %" — current, target, unit. */
function metric(kr: KeyResult): string {
  const unit = kr.unit ? ` ${kr.unit}` : "";
  return `${kr.currentValue} / ${kr.targetValue}${unit}`;
}

/**
 * The board's objectives and their key results (037) — the OKR surface. An
 * objective is a qualitative outcome; its key results are the measurable targets
 * whose mean is the objective's progress. Beside it, the work rollup (031's epic
 * shape) counts the linked tasks in the done column. All management is member-
 * level: deleting an objective un-aims its tasks and milestones (SET NULL) and
 * takes only its own key results with it (CASCADE).
 */
export function ObjectivesDialog({
  boardId,
  open,
  objectives,
  canEdit,
  onOpenChange,
  onChanged,
}: ObjectivesDialogProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      () =>
        api.createObjective(boardId, {
          name: trimmed,
          description: description.trim() || undefined,
          dueDate: dueDate || null,
        }),
      "Could not create the objective"
    );
    if (ok) {
      setName("");
      setDescription("");
      setDueDate("");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Objectives</DialogTitle>
          <DialogDescription>
            Measurable outcomes this board aims at. An objective’s progress is the
            average of its key results; the count beside it is linked tasks in the
            done column.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        {objectives.length === 0 ? (
          <p className="text-sm text-muted-foreground">No objectives yet.</p>
        ) : (
          <ul className="grid gap-3">
            {objectives.map((objective) => (
              <ObjectiveCard
                key={objective.id}
                objective={objective}
                canEdit={canEdit}
                busy={busy}
                run={run}
              />
            ))}
          </ul>
        )}

        {canEdit && (
          <div className="grid gap-2 border-t pt-3">
            <Label htmlFor="objective-name">New objective</Label>
            <Input
              id="objective-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Delight new users"
            />
            <Input
              aria-label="Objective description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Why it matters (optional)"
            />
            <div className="flex items-center gap-2">
              <Input
                type="date"
                aria-label="Objective due date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="max-w-40"
              />
              <Button
                type="button"
                size="sm"
                disabled={busy || !name.trim()}
                onClick={create}
                className="ml-auto"
              >
                Add objective
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ObjectiveCard({
  objective,
  canEdit,
  busy,
  run,
}: {
  objective: Objective;
  canEdit: boolean;
  busy: boolean;
  run: (action: () => Promise<unknown>, failure: string) => Promise<boolean>;
}) {
  const [confirming, setConfirming] = useState(false);
  const overall = objective.progress === null ? null : pct(objective.progress);

  return (
    <li className="grid gap-2 rounded-lg border px-3 py-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{objective.name}</p>
          {objective.description && (
            <p className="truncate text-xs text-muted-foreground">
              {objective.description}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-xs tabular-nums text-muted-foreground">
            {overall === null ? "—" : `${overall}%`}
          </span>
          {canEdit && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 px-1.5 text-xs text-muted-foreground hover:text-destructive"
              disabled={busy}
              onClick={() =>
                confirming
                  ? run(
                      () => api.deleteObjective(objective.id),
                      "Could not delete the objective"
                    )
                  : setConfirming(true)
              }
              onBlur={() => setConfirming(false)}
            >
              {confirming ? "Really?" : "Delete"}
            </Button>
          )}
        </div>
      </div>

      {/* Overall progress = mean of the key results. Bar + words carry the same
          fact, the epic dialog's rule. */}
      {overall !== null && (
        <div
          className="h-1.5 overflow-hidden rounded-full bg-muted"
          role="img"
          aria-label={`Objective ${overall}% to target`}
        >
          <div
            className="h-full rounded-full bg-primary"
            style={{ width: `${overall}%` }}
          />
        </div>
      )}

      <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
        {objective.dueDate && (
          <span className="tabular-nums">Due {objective.dueDate}</span>
        )}
        <span className="tabular-nums">
          {objective.done}/{objective.total} tasks done
        </span>
      </div>

      {objective.keyResults.length > 0 && (
        <ul className="grid gap-1.5">
          {objective.keyResults.map((kr) => (
            <KeyResultRow
              key={kr.id}
              keyResult={kr}
              canEdit={canEdit}
              busy={busy}
              run={run}
            />
          ))}
        </ul>
      )}

      {canEdit && <AddKeyResult objectiveId={objective.id} busy={busy} run={run} />}
    </li>
  );
}

function KeyResultRow({
  keyResult,
  canEdit,
  busy,
  run,
}: {
  keyResult: KeyResult;
  canEdit: boolean;
  busy: boolean;
  run: (action: () => Promise<unknown>, failure: string) => Promise<boolean>;
}) {
  const [current, setCurrent] = useState(String(keyResult.currentValue));
  const [confirming, setConfirming] = useState(false);
  const done = pct(keyResult.progress);
  const dirty = current !== "" && Number(current) !== keyResult.currentValue;

  return (
    <li className="grid gap-1 rounded-md bg-muted/40 px-2 py-1.5">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="min-w-0 truncate">{keyResult.title}</span>
        <span className="shrink-0 tabular-nums text-muted-foreground">
          {metric(keyResult)} · {done}%
        </span>
      </div>
      <div
        className="h-1 overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={`${keyResult.title}: ${done}% to target`}
      >
        <div
          className="h-full rounded-full bg-primary"
          style={{ width: `${done}%` }}
        />
      </div>
      {canEdit && (
        <div className="flex items-center gap-1.5">
          <Input
            type="number"
            aria-label={`Current value for ${keyResult.title}`}
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            className="h-7 max-w-24 text-xs"
          />
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="h-7 px-2 text-xs"
            disabled={busy || !dirty}
            onClick={() =>
              run(
                () =>
                  api.updateKeyResult(keyResult.id, {
                    currentValue: Number(current),
                  }),
                "Could not update the key result"
              )
            }
          >
            Save
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ml-auto h-7 px-1.5 text-xs text-muted-foreground hover:text-destructive"
            disabled={busy}
            onClick={() =>
              confirming
                ? run(
                    () => api.deleteKeyResult(keyResult.id),
                    "Could not delete the key result"
                  )
                : setConfirming(true)
            }
            onBlur={() => setConfirming(false)}
          >
            {confirming ? "Really?" : "Delete"}
          </Button>
        </div>
      )}
    </li>
  );
}

function AddKeyResult({
  objectiveId,
  busy,
  run,
}: {
  objectiveId: number;
  busy: boolean;
  run: (action: () => Promise<unknown>, failure: string) => Promise<boolean>;
}) {
  const [title, setTitle] = useState("");
  const [start, setStart] = useState("");
  const [target, setTarget] = useState("");
  const [unit, setUnit] = useState("");

  const canAdd = title.trim() !== "" && target !== "" && !Number.isNaN(Number(target));

  async function add() {
    if (!canAdd) return;
    const ok = await run(
      () =>
        api.createKeyResult(objectiveId, {
          title: title.trim(),
          startValue: start === "" ? undefined : Number(start),
          targetValue: Number(target),
          unit: unit.trim() || undefined,
        }),
      "Could not add the key result"
    );
    if (ok) {
      setTitle("");
      setStart("");
      setTarget("");
      setUnit("");
    }
  }

  return (
    <div className="grid gap-1.5 border-t pt-2">
      <Input
        aria-label="Key result title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Key result (e.g. NPS)"
        className="h-7 text-xs"
      />
      <div className="flex items-center gap-1.5">
        <Input
          type="number"
          aria-label="Start value"
          value={start}
          onChange={(e) => setStart(e.target.value)}
          placeholder="Start"
          className="h-7 text-xs"
        />
        <Input
          type="number"
          aria-label="Target value"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          placeholder="Target"
          className="h-7 text-xs"
        />
        <Input
          aria-label="Unit"
          value={unit}
          onChange={(e) => setUnit(e.target.value)}
          placeholder="Unit"
          className="h-7 max-w-20 text-xs"
        />
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="h-7 shrink-0 px-2 text-xs"
          disabled={busy || !canAdd}
          onClick={add}
        >
          Add KR
        </Button>
      </div>
    </div>
  );
}
