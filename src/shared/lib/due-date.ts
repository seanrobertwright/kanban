"use client";

import { useSyncExternalStore } from "react";

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/**
 * Formats a 'YYYY-MM-DD' due date for display, as "17 Jul 2026".
 *
 * Pure string work — no Date, no toLocaleDateString — and both omissions are
 * deliberate. A Date would reintroduce the zone that 006 chose DATE to avoid,
 * and toLocaleDateString would resolve against the *server's* locale during SSR
 * and the reader's on the client, so the same card would render two different
 * strings and React would report a hydration mismatch. This renders identically
 * everywhere, which is the only property that matters for a value that is
 * identical everywhere.
 *
 * The year is always shown. "17 Jul" would be shorter and is what a card wants,
 * but knowing whether to omit the year means knowing the current year, and that
 * is a fact about the reader — see useToday for why that cannot be known during
 * the first render. An unambiguous date beats a compact one that changes shape
 * on hydration.
 */
export function formatDueDate(date: string): string {
  const [year, month, day] = date.split("-");
  const name = MONTHS[Number(month) - 1] ?? month;
  return `${Number(day)} ${name} ${year}`;
}

/**
 * The reader's local date as 'YYYY-MM-DD'.
 *
 * Built from local getFullYear/getMonth/getDate rather than toISOString, which
 * would convert to UTC and hand back tomorrow's date to anyone east of Greenwich
 * in the evening — the same class of mistake the DATE type parser exists to stop
 * on the way out of the database.
 */
function localToday(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * Today never changes while you are looking at it — or rather, it does once, at
 * midnight, and a board that has been open that long is already stale in a dozen
 * more visible ways. Subscribing to nothing is the honest description.
 *
 * Module-level so the reference is stable across renders; an inline arrow would
 * make React tear down and resubscribe on every one.
 */
const subscribe = () => () => {};

/** The server has no reader, and therefore no today. See useToday. */
const serverSnapshot = () => null;

/**
 * The reader's local date as 'YYYY-MM-DD', or null during SSR and the first
 * client render.
 *
 * A due date is zoneless (006), so "is this overdue?" is meaningless until
 * someone supplies a zone — and the only defensible one is the reader's, since
 * they are who the question is being asked on behalf of. But the reader's zone
 * does not exist during SSR: the server would answer in the container's zone
 * (UTC), so a card rendered at 8pm in Denver would arrive from the server saying
 * "overdue" about a task due today, and then disagree with itself on hydration.
 *
 * useSyncExternalStore rather than the usual useState + useEffect mount gate,
 * because its third argument is exactly this problem's name: getServerSnapshot
 * is "what should the server render for a value only the client can know". It
 * returns null, so the server and the first client render agree by construction
 * that nothing is overdue — neither of them knows — and the answer arrives on
 * hydration without the extra render pass an effect would cost.
 *
 * getSnapshot returns a freshly built string each call, which is safe only
 * because React compares with Object.is and equal strings are Object.is-equal.
 * The same code returning a fresh {year, month, day} object would re-render
 * forever.
 */
export function useToday(): string | null {
  return useSyncExternalStore(subscribe, localToday, serverSnapshot);
}
