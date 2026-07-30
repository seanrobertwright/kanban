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
import type { CapacityPlan, CapacityRow, TimeOff } from "../types";

interface CapacityDialogProps {
  boardId: number;
  workspaceId: string;
  open: boolean;
  /** admin may set roles and budgets, and book anyone's leave. */
  canManage: boolean;
  /** Whose leave the viewer may book without being an admin — their own (090). */
  currentUserId: string;
  onOpenChange: (open: boolean) => void;
}

const pct = (u: number) => Math.round(u * 100);

/** A stored ISO date as a short label. UTC-parsed so it cannot render a day off
 *  by one for a viewer west of the line. */
function shortDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** "Jul 30" for a single day, "Jul 30 – Aug 5" for a range (both ends inclusive). */
function rangeLabel(entry: TimeOff): string {
  return entry.startsOn === entry.endsOn
    ? shortDate(entry.startsOn)
    : `${shortDate(entry.startsOn)} – ${shortDate(entry.endsOn)}`;
}

/**
 * Resource & capacity planning (041): the board's open work weighed against each
 * member's role and weekly point budget. Two lenses at once — who carries what
 * (resource planning) and where demand outstrips capacity (capacity planning,
 * over-allocated rows flagged). Self-fetching like Insights/Timesheet — capacity
 * is planning config, not on BoardData. Admin edits roles and budgets inline.
 *
 * Time off (090) is shown where it bites: the budget on each row is the prorated
 * one, with the nominal figure and the days away beside it, so a reader can see
 * *why* a number shrank instead of doubting it.
 */
export function CapacityDialog({
  boardId,
  workspaceId,
  open,
  canManage,
  currentUserId,
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
            budget, less any time off
            {plan && <> in the week of {shortDate(plan.week.start)}</>}.
            Over-allocated members are flagged.
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
                isSelf={row.userId === currentUserId}
                weekStart={plan.week.start}
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

            {/* Rollup — total demand vs the capacity the week actually has. */}
            <div className="mt-1 flex items-center justify-between gap-2 border-t pt-2 text-sm">
              <span className="text-muted-foreground">
                {plan.rows.length} {plan.rows.length === 1 ? "member" : "members"}
              </span>
              <span className="tabular-nums text-muted-foreground">
                {plan.totals.committed}/{plan.totals.available} pts committed
                {plan.totals.available !== plan.totals.capacity && (
                  <> · {plan.totals.capacity} before time off</>
                )}
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
  isSelf,
  weekStart,
  onSaved,
  onError,
}: {
  row: CapacityRow;
  workspaceId: string;
  canManage: boolean;
  isSelf: boolean;
  weekStart: string;
  onSaved: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [role, setRole] = useState(row.role);
  const [points, setPoints] = useState(String(row.weeklyPoints));
  const [busy, setBusy] = useState(false);
  const [booking, setBooking] = useState(false);
  const [from, setFrom] = useState(weekStart);
  const [to, setTo] = useState(weekStart);
  const [note, setNote] = useState("");

  const dirty = role !== row.role || Number(points) !== row.weeklyPoints;
  const over = isOverAllocated(row);
  // Away all week: no ratio to draw, but the row is still flagged if work is
  // parked on them (isOverAllocated does not read utilization).
  const barWidth = row.utilization === null ? 0 : Math.min(row.utilization, 1) * 100;
  // Leave is yours to record, or an admin's to record for you (090).
  const canBook = canManage || isSelf;

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

  async function bookTimeOff() {
    setBusy(true);
    try {
      await api.createTimeOff(workspaceId, {
        userId: row.userId,
        startsOn: from,
        endsOn: to,
        note: note.trim(),
      });
      setNote("");
      setBooking(false);
      await onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not book time off");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(entryId: number) {
    setBusy(true);
    try {
      await api.deleteTimeOff(workspaceId, entryId);
      await onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not remove time off");
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
          {row.weeklyPoints > 0 ? `/${row.availablePoints}` : ""} pts
          {row.utilization !== null && <> · {pct(row.utilization)}%</>}
          {row.daysOff > 0 && (
            <>
              {" "}
              · away {row.daysOff}
              {row.daysOff >= 5 ? " days" : `/5 days`}
            </>
          )}
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

      {/* Time off (090): the absences still ahead, each revocable by its owner
          or an admin, plus the booking form behind one click. */}
      {(row.timeOff.length > 0 || canBook) && (
        <div className="flex flex-wrap items-center gap-1.5 border-t pt-1.5 text-xs text-muted-foreground">
          {row.timeOff.map((entry) => (
            <span
              key={entry.id}
              className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5"
              title={entry.note || undefined}
            >
              {rangeLabel(entry)}
              {entry.note && <span className="opacity-70">· {entry.note}</span>}
              {canBook && (
                <button
                  type="button"
                  aria-label={`Remove time off ${rangeLabel(entry)} for ${row.name}`}
                  className="opacity-60 hover:opacity-100"
                  disabled={busy}
                  onClick={() => revoke(entry.id)}
                >
                  ×
                </button>
              )}
            </span>
          ))}

          {canBook && !booking && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="ml-auto h-6 px-2 text-xs"
              onClick={() => setBooking(true)}
            >
              Add time off
            </Button>
          )}

          {canBook && booking && (
            <div className="ml-auto flex flex-wrap items-center gap-1.5">
              <Input
                type="date"
                aria-label={`Time off start for ${row.name}`}
                value={from}
                onChange={(e) => {
                  setFrom(e.target.value);
                  // A range that ends before it starts is refused server-side;
                  // dragging the end along keeps the common single-day case one click.
                  if (e.target.value > to) setTo(e.target.value);
                }}
                className="h-7 w-32 text-xs"
              />
              <Input
                type="date"
                aria-label={`Time off end for ${row.name}`}
                value={to}
                min={from}
                onChange={(e) => setTo(e.target.value)}
                className="h-7 w-32 text-xs"
              />
              <Input
                aria-label={`Time off note for ${row.name}`}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Note"
                className="h-7 max-w-28 text-xs"
              />
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="h-7 px-2 text-xs"
                disabled={busy || !from || !to}
                onClick={bookTimeOff}
              >
                Book
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                onClick={() => setBooking(false)}
              >
                Cancel
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
