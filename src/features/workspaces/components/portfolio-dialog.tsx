"use client";

import { useEffect, useState } from "react";
import { LayoutDashboard } from "lucide-react";

import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { fetchPortfolio } from "../client/api";
import { donePercent } from "../lib/portfolio";
import type { Portfolio } from "../types";

/**
 * The portfolio (040): every board in the workspace at a glance — completion,
 * milestones, overdue work — in a dialog reached from the header, beside the
 * board switcher. Read-only: each row links to its board, where the work is
 * actually done. Like Insights and the Timesheet it is a glance-and-close
 * surface, not a saved lens.
 */
export function PortfolioButton({ workspaceId }: { workspaceId: string }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Portfolio | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        setError(null);
        const portfolio = await fetchPortfolio(workspaceId);
        if (!cancelled) setData(portfolio);
      } catch (e) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "Could not load portfolio");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, workspaceId]);

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="text-muted-foreground"
        onClick={() => setOpen(true)}
      >
        <LayoutDashboard /> Portfolio
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Portfolio</DialogTitle>
            <DialogDescription>
              Every board in this workspace at a glance.
            </DialogDescription>
          </DialogHeader>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          {data && data.boards.length === 0 && (
            <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              No boards in this workspace yet.
            </p>
          )}

          {data && data.boards.length > 0 && (
            <div className="grid gap-2">
              {data.boards.map((b) => {
                const pct = donePercent(b.done, b.total);
                return (
                  <a
                    key={b.id}
                    href={`/?board=${b.id}`}
                    className="grid gap-1.5 rounded-lg border p-3 transition-colors hover:bg-muted/50"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-medium">{b.name}</span>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        {b.hasDoneColumn ? (
                          <>
                            {b.done}/{b.total} done · {pct}%
                          </>
                        ) : (
                          <>{b.total} tasks</>
                        )}
                      </span>
                    </div>
                    {/* Progress bar — only meaningful once a done column exists;
                        without one the board has no completion notion, so the bar
                        stays empty rather than implying 0%. */}
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                      {b.hasDoneColumn && (
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{ width: `${pct}%` }}
                        />
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span>
                        {b.milestones}{" "}
                        {b.milestones === 1 ? "milestone" : "milestones"}
                      </span>
                      {b.overdue > 0 && (
                        <span className="text-destructive">
                          {b.overdue} overdue
                        </span>
                      )}
                    </div>
                  </a>
                );
              })}

              {/* Portfolio rollup — the workspace's numbers across its boards. */}
              <div className="mt-1 flex items-center justify-between gap-2 border-t pt-2 text-sm">
                <span className="text-muted-foreground">
                  {data.totals.boards}{" "}
                  {data.totals.boards === 1 ? "board" : "boards"}
                </span>
                <span className="tabular-nums text-muted-foreground">
                  {data.totals.done}/{data.totals.total} tasks done
                  {data.totals.overdue > 0 && (
                    <span className="ml-2 text-destructive">
                      {data.totals.overdue} overdue
                    </span>
                  )}
                </span>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
