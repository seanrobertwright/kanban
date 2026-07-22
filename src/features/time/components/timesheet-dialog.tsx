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
import { fetchBoardTimesheet } from "../client/api";
import { addDays } from "../lib/timesheet";
import { formatMinutes, type Timesheet } from "../types";

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
}: {
  boardId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [data, setData] = useState<Timesheet | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The window the *next* fetch asks for. null on first open → server defaults
  // to the week ending today; the response's from/to then seed navigation.
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);

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
  }, [open, boardId, range]);

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

  const days = data?.days ?? [];

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
