"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { fetchBoardTimesheet, reviewTimesheet } from "../client/api";
import { addDays } from "../lib/timesheet";
import { formatMinutes, type TimesheetWithApprovals } from "../types";

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Mon 20" from a 'YYYY-MM-DD' string, read through UTC so the weekday never
 *  drifts a day in a client's local zone (schedule.ts's discipline). */
function dayHeader(iso: string): { top: string; bottom: string } {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return { top: WEEKDAY[dt.getUTCDay()], bottom: String(d) };
}

/**
 * A board's timesheet: the time_entry ledger (027) rolled up per
 * contributor per day over a week, in a dialog rather than a lens — like
 * Insights, it is something you glance at and close, not a saved filter. The
 * window navigates a week at a time; the server defaults and clamps it, so the
 * first open needs no dates. Time tracking is humans-only, so every row is a
 * person — an agent's spend is metered in dollars, not minutes here.
 */
export function TimesheetDialog({
  boardId,
  open,
  onOpenChange,
  currentUserId,
  canReview,
}: {
  boardId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Whose row carries the Submit button — you may only submit your own week. */
  currentUserId: string;
  /** Admin+: the rank that may approve or reject someone else's week (083). */
  canReview: boolean;
}) {
  const [data, setData] = useState<TimesheetWithApprovals | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The window the *next* fetch asks for. null on first open → server defaults
  // to the week ending today; the response's from/to then seed navigation.
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  // Bumped after a verdict so the same window refetches — setRange alone would
  // be a no-op when the window has not moved.
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        setError(null);
        const sheet = await fetchBoardTimesheet(boardId, range ?? {});
        if (!cancelled) setData(sheet);
      } catch (e) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "Could not load timesheet");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, boardId, range, reloadKey]);

  // Reset to the default (today's) week when the dialog closes, so a reopen
  // never lingers on a week navigated to before — done on the close event rather
  // than in an effect, which would be a synchronous setState-in-effect.
  function handleOpenChange(next: boolean) {
    if (!next) setRange(null);
    onOpenChange(next);
  }

  function shiftWeek(deltaDays: number) {
    if (!data) return;
    setRange({
      from: addDays(data.from, deltaDays),
      to: addDays(data.to, deltaDays),
    });
  }

  /**
   * Send a verdict, then reload — the row that comes back is one week's, and
   * the grid shows a window that may span two. Refetching is cheaper than
   * reconciling those by hand and cannot disagree with the server.
   */
  async function review(
    verdict: "submitted" | "approved" | "rejected",
    userId?: string
  ) {
    if (!data) return;
    setError(null);
    try {
      let note = "";
      if (verdict === "rejected") {
        // A rejection needs a reason (the server refuses one without), and the
        // contributor is the only audience for it.
        note = window.prompt("Why is this week being rejected?")?.trim() ?? "";
        if (!note) return;
      }
      await reviewTimesheet(boardId, {
        week: data.from,
        verdict,
        userId,
        note,
      });
      setRange({ from: data.from, to: data.to });
      setReloadKey((k) => k + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not record the verdict");
    }
  }

  const days = data?.days ?? [];
  /** The verdict on a contributor's week, if the window carries one. */
  const verdictFor = (userId: string) =>
    data?.approvals.find((a) => a.userId === userId) ?? null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Timesheet</DialogTitle>
          <DialogDescription>
            Logged time per contributor per day across this board.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        {data && (
          <div className="grid gap-3">
            <div className="flex items-center justify-between">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => shiftWeek(-7)}
                aria-label="Previous week"
              >
                <ChevronLeft />
              </Button>
              <span className="text-sm tabular-nums text-muted-foreground">
                {data.from} – {data.to}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => shiftWeek(7)}
                aria-label="Next week"
              >
                <ChevronRight />
              </Button>
            </div>

            {data.rows.length === 0 ? (
              <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                No time logged in this window.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      <th className="py-1 pr-2 text-left font-medium">
                        Contributor
                      </th>
                      {days.map((d) => {
                        const h = dayHeader(d);
                        return (
                          <th
                            key={d}
                            className="px-1 py-1 text-center text-xs font-medium tabular-nums"
                          >
                            <div>{h.top}</div>
                            <div className="text-muted-foreground/70">
                              {h.bottom}
                            </div>
                          </th>
                        );
                      })}
                      <th className="py-1 pl-2 text-right font-medium">Total</th>
                      <th className="py-1 pl-3 text-right font-medium">Sign-off</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((row) => (
                      <tr key={row.userId} className="border-b last:border-0">
                        <td className="max-w-40 truncate py-1 pr-2">
                          {row.userName ?? "A removed user"}
                        </td>
                        {days.map((d) => (
                          <td
                            key={d}
                            className="px-1 py-1 text-center tabular-nums"
                          >
                            {row.byDay[d] ? (
                              formatMinutes(row.byDay[d])
                            ) : (
                              <span className="text-muted-foreground/40">·</span>
                            )}
                          </td>
                        ))}
                        <td className="py-1 pl-2 text-right font-medium tabular-nums">
                          {formatMinutes(row.total)}
                        </td>
                        <td className="py-1 pl-3 text-right whitespace-nowrap">
                          {(() => {
                            const v = verdictFor(row.userId);
                            return (
                              <span className="inline-flex items-center gap-1">
                                {v && (
                                  <span
                                    className={
                                      v.status === "approved"
                                        ? "text-primary"
                                        : v.status === "rejected"
                                          ? "text-destructive"
                                          : "text-muted-foreground"
                                    }
                                    title={v.note || undefined}
                                  >
                                    {v.status}
                                  </span>
                                )}
                                {row.userId === currentUserId &&
                                  v?.status !== "submitted" && (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => void review("submitted")}
                                    >
                                      Submit
                                    </Button>
                                  )}
                                {canReview && v?.status !== "approved" && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => void review("approved", row.userId)}
                                  >
                                    Approve
                                  </Button>
                                )}
                                {canReview && v?.status !== "rejected" && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="text-muted-foreground hover:text-destructive"
                                    onClick={() => void review("rejected", row.userId)}
                                  >
                                    Reject
                                  </Button>
                                )}
                              </span>
                            );
                          })()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t font-medium text-muted-foreground">
                      <td className="py-1 pr-2 text-left">All</td>
                      {days.map((d) => (
                        <td
                          key={d}
                          className="px-1 py-1 text-center tabular-nums"
                        >
                          {data.dayTotals[d] ? formatMinutes(data.dayTotals[d]) : ""}
                        </td>
                      ))}
                      <td className="py-1 pl-2 text-right tabular-nums">
                        {formatMinutes(data.total)}
                      </td>
                      {/* The Sign-off column has no total — a week is signed
                          off per person, and "3 of 5 approved" is a different
                          claim from anything this footer makes. */}
                      <td className="py-1 pl-3" />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
