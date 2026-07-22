"use client";

import { useMemo } from "react";
import { Flag } from "lucide-react";

import type { Epic } from "@/features/epics/types";
import type { Milestone } from "@/features/milestones/types";
import { useToday } from "@/shared/lib/due-date";
import { addDays, dayDiff, shortLabel } from "../lib/schedule";
import { buildRoadmap } from "../lib/roadmap";

/**
 * The roadmap lens (038): the level above the task board. Each epic (031) is a
 * swimlane and the milestones (026) filed under it are dated markers across one
 * shared time track, each showing its own done/total rollup. It reuses the
 * Timeline's percentage-positioning (a window can be a year wide) and its window
 * padding, but the unit is a milestone's single due date, not a task's span.
 *
 * Clicking any milestone opens the Milestones dialog — the roadmap reads the
 * plan; editing a date or a rollup stays where milestone CRUD already lives.
 */
export function RoadmapView({
  milestones,
  epics,
  onOpenMilestones,
}: {
  milestones: Milestone[];
  epics: Epic[];
  onOpenMilestones: () => void;
}) {
  const today = useToday();
  const { window, lanes } = useMemo(
    () => buildRoadmap(milestones, epics),
    [milestones, epics]
  );

  // Weekly gridlines: an offset (days from the window start) per 7-day step,
  // labelled with its date — the Timeline's scaffolding, verbatim.
  const ticks = useMemo(() => {
    if (!window) return [];
    const out: { offset: number; label: string }[] = [];
    for (let d = 0; d < window.total; d += 7) {
      out.push({ offset: d, label: shortLabel(addDays(window.start, d)) });
    }
    return out;
  }, [window]);

  if (milestones.length === 0) {
    return (
      <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
        No milestones yet. Add a milestone (with a due date and an epic) and it
        appears here as a marker on the roadmap.
      </p>
    );
  }

  const pct = (n: number) => (window ? `${(n / window.total) * 100}%` : "0%");
  const todayOffset =
    window && today && today >= window.start && today <= window.end
      ? dayDiff(window.start, today)
      : null;

  return (
    <div className="grid gap-3">
      <div className="flex items-center gap-2 text-sm">
        <h2 className="font-medium">Roadmap</h2>
        {window && (
          <span className="text-muted-foreground">
            {shortLabel(window.start)} – {shortLabel(window.end)}
          </span>
        )}
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[36rem]">
          {/* Header: weekly date ticks across the track, offset by the lane
              label gutter so they align with the bars below. */}
          {window && (
            <div className="flex">
              <div className="w-44 shrink-0" aria-hidden />
              <div className="relative mb-1 h-5 flex-1 border-b">
                {ticks.map((t) => (
                  <span
                    key={t.offset}
                    className="absolute -translate-x-1/2 text-[10px] tabular-nums text-muted-foreground"
                    style={{ left: pct(t.offset) }}
                  >
                    {t.label}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="grid gap-2">
            {lanes.map((lane) => (
              <div
                key={lane.epicId ?? "unfiled"}
                className="flex items-stretch gap-0 rounded-lg border p-2"
              >
                {/* Lane label + rollup — the swimlane's identity. */}
                <div className="flex w-44 shrink-0 flex-col justify-center gap-0.5 pr-2">
                  <span
                    className={`truncate text-sm font-medium ${
                      lane.epicId === null ? "text-muted-foreground italic" : ""
                    }`}
                    title={lane.epicName}
                  >
                    {lane.epicName}
                  </span>
                  <span className="text-[11px] tabular-nums text-muted-foreground">
                    {lane.done}/{lane.total} tasks done
                  </span>
                  {lane.undated.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {lane.undated.map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          onClick={onOpenMilestones}
                          title={`${m.name} · no due date`}
                          className="max-w-40 truncate rounded border border-dashed px-1 py-0.5 text-[10px] hover:bg-muted/50"
                        >
                          {m.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Track: the dated milestones as markers, weekly gridlines and a
                    today line behind them. Empty when the lane has only undated
                    milestones, which then live entirely in the label gutter. */}
                <div className="relative min-h-9 flex-1 border-l pl-2">
                  <div className="pointer-events-none absolute inset-0" aria-hidden>
                    {ticks.map((t) => (
                      <span
                        key={t.offset}
                        className="absolute top-0 bottom-0 w-px bg-border/60"
                        style={{ left: pct(t.offset) }}
                      />
                    ))}
                    {todayOffset !== null && (
                      <span
                        className="absolute top-0 bottom-0 w-px bg-primary/70"
                        style={{ left: pct(todayOffset) }}
                      />
                    )}
                  </div>

                  {lane.dated.map(({ milestone, offset }) => (
                    <MilestoneMarker
                      key={milestone.id}
                      milestone={milestone}
                      left={pct(offset)}
                      onClick={onOpenMilestones}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** One dated milestone on a lane's track: a flag pill whose fill shows how far
 *  its tasks have gone (done/total). Absolute-positioned by the same percentage
 *  the ticks use, so it stays locked to the date scale at any width. */
function MilestoneMarker({
  milestone,
  left,
  onClick,
}: {
  milestone: Milestone;
  left: string;
  onClick: () => void;
}) {
  const ratio =
    milestone.total > 0 ? milestone.done / milestone.total : 0;
  const complete = milestone.total > 0 && milestone.done === milestone.total;
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${milestone.name} · due ${milestone.dueDate} · ${milestone.done}/${milestone.total} done`}
      className="absolute top-1/2 flex max-w-56 -translate-y-1/2 items-center gap-1 overflow-hidden rounded border bg-background px-1.5 py-1 text-left text-xs shadow-sm hover:ring-2 hover:ring-ring/50"
      style={{ left }}
    >
      {/* A progress fill sitting under the label — the milestone dialog's bar,
          shrunk to a marker. */}
      <span
        className="pointer-events-none absolute inset-y-0 left-0 bg-primary/15"
        style={{ width: `${Math.round(ratio * 100)}%` }}
        aria-hidden
      />
      <Flag
        className={`relative size-3 shrink-0 ${
          complete ? "text-primary" : "text-muted-foreground"
        }`}
        aria-hidden
      />
      <span className="relative truncate font-medium">{milestone.name}</span>
      <span className="relative tabular-nums text-muted-foreground">
        {milestone.done}/{milestone.total}
      </span>
    </button>
  );
}
