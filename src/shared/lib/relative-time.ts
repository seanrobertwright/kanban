const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31536000],
  ["month", 2592000],
  ["day", 86400],
  ["hour", 3600],
  ["minute", 60],
];

/**
 * "3 minutes ago", from an ISO string.
 *
 * Shared by the activity feed and the comment thread, which sit inches apart in
 * the same dialog: two copies of this would eventually round differently, and a
 * comment stamped "2 hours ago" beside a log entry for the same instant stamped
 * "1 hour ago" reads as a bug in the audit trail — the one thing here that has
 * to be believed.
 *
 * `now` is passed in rather than read from the clock, so every row in a render
 * measures against the same instant and the output does not depend on render
 * timing.
 */
export function relativeTime(iso: string, now: number): string {
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 45) return "just now";
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  for (const [unit, size] of UNITS) {
    if (abs >= size) return format.format(Math.round(seconds / size), unit);
  }
  return "just now";
}
