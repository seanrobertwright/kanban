import type { Epic } from "@/features/epics/types";
import type { Milestone } from "@/features/milestones/types";
import { addDays, dayDiff } from "./schedule";

/**
 * The maths behind the Roadmap lens (038), kept pure and out of the component so
 * the grouping and the time window can be unit-tested the way schedule.ts is.
 *
 * A roadmap is the level above a task board: epics (031) are swimlanes and the
 * milestones (026) filed under each are dated markers on a shared track. All the
 * calendar work stays on 'YYYY-MM-DD' strings — only the window steps day counts
 * through Date, schedule.ts's discipline (a zoneless date must never pass through
 * the server's local `new Date()`).
 */

export interface RoadmapMarker {
  milestone: Milestone;
  /** Whole days from the window start to this milestone's due date. */
  offset: number;
}

export interface RoadmapLane {
  /** The epic this lane draws, or null for the "Unfiled" lane. */
  epicId: number | null;
  epicName: string;
  /** Lane rollup — the sum of its milestones' own task rollups, so the Unfiled
   *  lane (which has no epic to ask) totals the same way an epic lane does. */
  total: number;
  done: number;
  /** Milestones with a due date, earliest first — the markers on the track. */
  dated: RoadmapMarker[];
  /** Milestones with no due date — a bucket before it is a deadline (026). */
  undated: Milestone[];
}

export interface Roadmap {
  /** The dated milestones' extent, padded; null when nothing is dated. */
  window: { start: string; end: string; total: number } | null;
  /** Lanes in epic order, the Unfiled lane last; only lanes with ≥1 milestone. */
  lanes: RoadmapLane[];
}

/** Group `milestones` into epic swimlanes and compute the shared time window. */
export function buildRoadmap(
  milestones: Milestone[],
  epics: Epic[]
): Roadmap {
  // The window is the dated milestones' min→max due date, padded two days each
  // side so the earliest marker is not flush against the edge. Null when no
  // milestone carries a date — then every lane renders as an undated bucket.
  const dates = milestones
    .map((m) => m.dueDate)
    .filter((d): d is string => d != null)
    .sort();
  const window =
    dates.length === 0
      ? null
      : (() => {
          const start = addDays(dates[0], -2);
          const end = addDays(dates[dates.length - 1], 2);
          return { start, end, total: dayDiff(start, end) + 1 };
        })();

  // A lane per epic (in the board's epic order), plus a trailing Unfiled lane —
  // built only for the groups that actually hold a milestone, so an empty epic
  // does not draw a blank row.
  const order: (number | null)[] = [...epics.map((e) => e.id), null];
  const nameOf = new Map<number | null, string>(
    epics.map((e) => [e.id as number | null, e.name])
  );
  nameOf.set(null, "Unfiled");

  const lanes: RoadmapLane[] = [];
  for (const epicId of order) {
    const members = milestones.filter((m) => (m.epicId ?? null) === epicId);
    if (members.length === 0) continue;

    const dated = members
      .filter((m) => m.dueDate != null && window != null)
      .map((m) => ({
        milestone: m,
        offset: dayDiff(window!.start, m.dueDate as string),
      }))
      .sort((a, b) => a.offset - b.offset);
    const undated = members.filter((m) => m.dueDate == null);

    lanes.push({
      epicId,
      epicName: nameOf.get(epicId) ?? "Unfiled",
      total: members.reduce((s, m) => s + m.total, 0),
      done: members.reduce((s, m) => s + m.done, 0),
      dated,
      undated,
    });
  }

  return { window, lanes };
}
