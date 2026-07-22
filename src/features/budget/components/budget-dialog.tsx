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
import { Label } from "@/shared/ui/label";
import * as api from "../client/api";
import { budgetUtilization } from "../lib/budget";
import type { BoardBudget } from "../types";

interface BudgetDialogProps {
  boardId: number;
  open: boolean;
  /** admin may set the budget/rate; everyone viewer+ sees the figures. */
  canManage: boolean;
  onOpenChange: (open: boolean) => void;
}

function money(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
    }).format(amount);
  } catch {
    // An unknown currency code just shows the number with the code appended.
    return `${amount.toFixed(2)} ${currency}`;
  }
}

const hours = (minutes: number) => (minutes / 60).toFixed(1);

/**
 * Budget / financial planning (042): the project's money. Budget and rate are
 * set on the board; spend is derived from the logged-time ledger (027) × the
 * rate, with a per-contributor breakdown. Self-fetching like Insights/Timesheet
 * — a budget figure is not on BoardData. Admin sets the numbers; over-budget is
 * flagged.
 */
export function BudgetDialog({
  boardId,
  open,
  canManage,
  onOpenChange,
}: BudgetDialogProps) {
  const [budget, setBudget] = useState<BoardBudget | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        setError(null);
        const b = await api.fetchBudget(boardId);
        if (!cancelled) setBudget(b);
      } catch (e) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "Could not load budget");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, boardId]);

  const util =
    budget && budgetUtilization(budget.budgetAmount, budget.spend);
  const over = util !== null && util !== undefined && util > 1;
  const barWidth = util === null || util === undefined ? 0 : Math.min(util, 1) * 100;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Budget</DialogTitle>
          <DialogDescription>
            The project’s budget and labour rate. Spend is logged time costed at
            the rate.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        {budget && (
          <div className="grid gap-3">
            <div className="grid grid-cols-3 gap-2 text-center">
              <Figure
                label="Budget"
                value={
                  budget.budgetAmount === null
                    ? "—"
                    : money(budget.budgetAmount, budget.currency)
                }
              />
              <Figure label="Spent" value={money(budget.spend, budget.currency)} />
              <Figure
                label="Remaining"
                value={
                  budget.remaining === null
                    ? "—"
                    : money(budget.remaining, budget.currency)
                }
                tone={
                  budget.remaining !== null && budget.remaining < 0
                    ? "destructive"
                    : undefined
                }
              />
            </div>

            {util !== null && util !== undefined && (
              <div
                className="h-2 overflow-hidden rounded-full bg-muted"
                role="img"
                aria-label={`${Math.round(util * 100)}% of budget spent`}
              >
                <div
                  className={`h-full rounded-full ${over ? "bg-destructive" : "bg-primary"}`}
                  style={{ width: `${barWidth}%` }}
                />
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              {hours(budget.loggedMinutes)} h logged at{" "}
              {money(budget.hourlyRate, budget.currency)}/h
              {over && (
                <span className="ml-1 font-medium text-destructive">
                  · over budget
                </span>
              )}
            </p>

            {budget.contributors.length > 0 && (
              <ul className="grid gap-1 border-t pt-2">
                {budget.contributors.map((c) => (
                  <li
                    key={c.userId}
                    className="flex items-center justify-between gap-2 text-sm"
                  >
                    <span className="truncate">{c.name}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {hours(c.minutes)} h · {money(c.cost, budget.currency)}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {canManage && (
              <BudgetEditor
                boardId={boardId}
                budget={budget}
                onSaved={setBudget}
                onError={setError}
              />
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Figure({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "destructive";
}) {
  return (
    <div className="rounded-lg border p-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={`truncate text-sm font-semibold tabular-nums ${
          tone === "destructive" ? "text-destructive" : ""
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function BudgetEditor({
  boardId,
  budget,
  onSaved,
  onError,
}: {
  boardId: number;
  budget: BoardBudget;
  onSaved: (b: BoardBudget) => void;
  onError: (message: string) => void;
}) {
  const [amount, setAmount] = useState(
    budget.budgetAmount === null ? "" : String(budget.budgetAmount)
  );
  const [rate, setRate] = useState(String(budget.hourlyRate));
  const [currency, setCurrency] = useState(budget.currency);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const next = await api.setBudget(boardId, {
        budgetAmount: amount.trim() === "" ? null : Number(amount),
        hourlyRate: Number(rate) || 0,
        currency: currency.trim() || "USD",
      });
      onSaved(next);
      setAmount(next.budgetAmount === null ? "" : String(next.budgetAmount));
      setRate(String(next.hourlyRate));
      setCurrency(next.currency);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not save budget");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-2 border-t pt-3">
      <div className="grid grid-cols-3 gap-2">
        <label className="grid gap-1 text-xs text-muted-foreground">
          Budget
          <Input
            type="number"
            aria-label="Budget amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="none"
            className="h-8"
          />
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">
          Rate /h
          <Input
            type="number"
            aria-label="Hourly rate"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            className="h-8"
          />
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">
          Currency
          <Input
            aria-label="Currency"
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            className="h-8"
          />
        </label>
      </div>
      <Label className="sr-only">Save budget</Label>
      <Button
        type="button"
        size="sm"
        className="justify-self-end"
        disabled={busy}
        onClick={save}
      >
        Save
      </Button>
    </div>
  );
}
