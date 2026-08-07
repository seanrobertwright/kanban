/**
 * Where a date label sits relative to the tick it names, on the Timeline and
 * the Gantt (UI-1).
 *
 * A label is centred on its tick, which is right everywhere except at the two
 * ends: there, half the label falls outside the track and the view's
 * `overflow-x-auto` clips it — "Aug 5" rendered as "g 5". The extremes are
 * pulled inside instead, the first tick aligning its left edge to the tick and
 * a tick near the end its right edge.
 *
 * Only the extremes. Interpolating the shift across the whole axis would also
 * stop the clipping and needs no threshold, but it drifts every label off the
 * date it marks — and on these two views the labels are the only thing that
 * says where a bar begins. A label that has moved is worse than one that is
 * clipped, because the clip is visible and the drift is not.
 *
 * Padding the track would misalign the labels from the bars, which share the
 * same percentage scale; that scale agreeing at any width is the whole design.
 */

/**
 * How close to an end a tick must be before its label is pulled in, as a
 * fraction of the track.
 *
 * A label is at most ~40px ("Sep 12" in `text-micro tabular-nums`) against a
 * track of at least `min-w-[32rem]` = 512px, so half a label is under 4% of the
 * narrowest track this can render on, and less of any wider one. Erring high
 * costs nothing: the only ticks it can catch are ones already within a label's
 * width of the edge, where centring was never going to survive anyway.
 */
export const LABEL_EDGE_ALLOWANCE = 0.04;

export function tickLabelTransform(fraction: number): string {
  // NaN falls through both comparisons to the centred default rather than
  // resolving to an end, which is the least wrong thing an unknown offset can
  // do — and matches what every tick did before this function existed.
  if (fraction <= 0) return "translateX(0)";
  if (fraction >= 1 - LABEL_EDGE_ALLOWANCE) return "translateX(-100%)";
  return "translateX(-50%)";
}
