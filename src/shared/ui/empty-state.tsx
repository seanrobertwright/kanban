import type { LucideIcon } from "lucide-react";

import { cn } from "@/shared/lib/utils";

/**
 * The designed version of "there is nothing here".
 *
 * A bare line of grey text is ambiguous in the one way that matters: it cannot
 * tell you whether the view is empty because nothing exists yet or because your
 * filter excluded everything, and those want opposite next actions. So an empty
 * state here always says which situation it is (`title`), why (`hint`), and
 * offers the thing to do about it (`action`).
 */
export function EmptyState({
  icon: Icon,
  title,
  hint,
  action,
  dense,
  className,
}: {
  icon: LucideIcon;
  title: string;
  hint?: string;
  action?: React.ReactNode;
  /**
   * For an empty *section* rather than an empty view — a subtask list inside a
   * task panel, the workload block inside Insights. Same anatomy at a smaller
   * scale, because the alternative is every such call site inventing its own
   * padding override, which is the ad-hoc sizing habit this pass exists to end.
   */
  dense?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid justify-items-center gap-2 rounded-xl border border-dashed text-center",
        dense ? "gap-1.5 px-4 py-6" : "px-6 py-12",
        className
      )}
    >
      <span
        className={cn(
          "flex items-center justify-center rounded-lg border border-primary/20 bg-primary/5 text-primary",
          dense ? "size-8" : "size-10"
        )}
        aria-hidden
      >
        <Icon className={dense ? "size-4" : "size-5"} />
      </span>
      <p className={cn("font-medium", dense ? "text-body" : "text-sm")}>
        {title}
      </p>
      {hint && (
        <p
          className={cn(
            "max-w-sm text-balance text-muted-foreground",
            dense ? "text-meta" : "text-sm"
          )}
        >
          {hint}
        </p>
      )}
      {action && <div className="pt-1">{action}</div>}
    </div>
  );
}
