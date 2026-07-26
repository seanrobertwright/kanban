"use client";

import { ChevronRight } from "lucide-react";

import { cn } from "@/shared/lib/utils";

/**
 * A section that starts folded.
 *
 * Built on `<details>`/`<summary>` rather than a state-plus-ARIA component of
 * our own: the platform already gives this the right role, the right keyboard
 * behaviour (Enter and Space toggle, the summary is a tab stop), and — the part
 * a JS implementation would have to build — in-page find lands inside a closed
 * section and opens it. None of that is worth reimplementing.
 *
 * The children always mount, open or closed. Every section this wraps fetches
 * its own data on mount, so lazy-mounting would turn "fold this away" into "do
 * not load this until asked", which is a different promise: the folded headings
 * would stop being able to show a count, and opening one would flash a spinner
 * on a panel that used to be ready. Folding here is about attention, not work.
 */
export function CollapsibleSection({
  title,
  hint,
  defaultOpen = false,
  children,
  className,
}: {
  title: string;
  /** A count or status shown on the closed heading, so folding hides the
   *  detail without hiding whether there is any. */
  hint?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <details
      open={defaultOpen}
      className={cn("group rounded-lg border bg-card/40", className)}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:bg-accent/50 [&::-webkit-details-marker]:hidden">
        <ChevronRight
          className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
          aria-hidden
        />
        <span className="min-w-0 flex-1 truncate">{title}</span>
        {hint != null && (
          <span className="shrink-0 text-xs font-normal text-muted-foreground">
            {hint}
          </span>
        )}
      </summary>
      <div className="border-t px-3 py-3">{children}</div>
    </details>
  );
}
