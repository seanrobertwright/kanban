"use client";

import { useEffect, useState } from "react";

import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import * as api from "../client/api";
import { isOverAllocated } from "../lib/capacity";
import type { CapacityPlan, CapacityRow } from "../types";

interface CapacityDialogProps {
  boardId: number;
  workspaceId: string;
  open: boolean;
  /** admin may set roles and budgets; everyone viewer+ sees the plan. */
  canManage: boolean;
  onOpenChange: (open: boolean) => void;
}

const pct = (u: number) => Math.round(u * 100);

/**
 * Resource & capacity planning (041): the board's open work weighed against each
 * member's role and weekly point budget. Two lenses at once — who carries what
 * (resource planning) and where demand outstrips capacity (capacity planning,
 * over-allocated rows flagged). Self-fetching like Insights/Timesheet — capacity
 * is planning config, not on BoardData. Admin edits roles and budgets inline.
 */
export function CapacityDialog({
  boardId,
  workspaceId,
  open,
  canManage,
  onOpenChange,
}: CapacityDialogProps) {
  const [plan, setPlan] = useState<CapacityPlan | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        setError(null);
        const p = await api.fetchCapacity(boardId);
        if (!cancelled) setPlan(p);
      } catch (e) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "Could not load capacity");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, boardId]);

  async function reload() {
    setPlan(await api.fetchCapacity(boardId));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Capacity</DialogTitle>
          <DialogDescription>
            Open work (in story points) weighed against each member’s weekly
            budget. Over-allocated members are flagged.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        {plan && plan.rows.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No members to plan against.
          </p>
        )}

        {plan && plan.rows.length > 0 && (
          <div className="grid gap-2">
            {plan.rows.map((row) => (
              <MemberCapacityRow
                key={row.userId}
                row={row}
                workspaceId={workspaceId}
                canManage={canManage}
                onSaved={reload}
                onError={setError}
              />
            ))}

            {/* Unassigned demand — work nobody is carrying yet. */}
            <div className="flex items-center justify-between gap-2 rounded-lg border border-dashed px-3 py-2 text-sm">
              <span className="text-muted-foreground">Unassigned</span>
              <span className="tabular-nums text-muted-foreground">
                {plan.unassigned.points} pts · {plan.unassigned.tasks}{" "}
                {plan.unassigned.tasks === 1 ? "task" : "tasks"}
              </span>
            </div>

            {/* Rollup — total demand vs total capacity across members. */}
            <div className="mt-1 flex items-center justify-between gap-2 border-t pt-2 text-sm">
              <span className="text-muted-foreground">
                {plan.rows.length} {plan.rows.length === 1 ? "member" : "members"}
              </span>
              <span className="tabular-nums text-muted-foreground">
                {plan.totals.committed}/{plan.totals.capacity} pts committed
              </span>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function MemberCapacityRow({
  row,
  workspaceId,
  canManage,
  onSaved,
  onError,
}: {
  row: CapacityRow;
  workspaceId: string;
  canManage: boolean;
  onSaved: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [role, setRole] = useState(row.role);
  const [points, setPoints] = useState(String(row.weeklyPoints));
  const [busy, setBusy] = useState(false);

  const dirty =
    role !== row.role || Number(points) !== row.weeklyPoints;
  const over = isOverAllocated(row);
  const barWidth = row.utilization === null ? 0 : Math.min(row.utilization, 1) * 100;

  async function save() {
    setBusy(true);
    try {
      await api.setMemberCapacity(workspaceId, row.userId, {
        weeklyPoints: Math.max(0, Math.floor(Number(points) || 0)),
        role: role.trim(),
      });
      await onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not save capacity");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-1.5 rounded-lg border px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <span className="truncate text-sm font-medium">{row.name}</span>
          {row.role && !canManage && (
            <span className="ml-2 text-xs text-muted-foreground">{row.role}</span>
          )}
        </div>
        <span
          className={`shrink-0 text-xs tabular-nums ${
            over ? "text-destructive" : "text-muted-foreground"
          }`}
        >
          {row.committedPoints}
          {row.weeklyPoints > 0 ? `/${row.weeklyPoints}` : ""} pts
          {row.utilization !== null && <> · {pct(row.utilization)}%</>}
          {over && <> · over</>}
        </span>
      </div>

      {/* Utilization bar — clamped at 100%; red when over-allocated. */}
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full ${over ? "bg-destructive" : "bg-primary"}`}
          style={{ width: `${barWidth}%` }}
        />
      </div>

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>{row.openTasks} open</span>
        {canManage && (
          <div className="ml-auto flex items-center gap-1.5">
            <Input
              aria-label={`Role for ${row.name}`}
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="Role"
              className="h-7 max-w-28 text-xs"
            />
            <Input
              type="number"
              aria-label={`Weekly points for ${row.name}`}
              value={points}
              onChange={(e) => setPoints(e.target.value)}
              className="h-7 max-w-20 text-xs"
            />
            <span>pts/wk</span>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="h-7 px-2 text-xs"
              disabled={busy || !dirty}
              onClick={save}
            >
              Save
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
