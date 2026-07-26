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
  className,
}: {
  icon: LucideIcon;
  title: string;
  hint?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid justify-items-center gap-2 rounded-xl border border-dashed px-6 py-12 text-center",
        className
      )}
    >
      <span
        className="flex size-10 items-center justify-center rounded-lg border border-primary/20 bg-primary/5 text-primary"
        aria-hidden
      >
        <Icon className="size-5" />
      </span>
      <p className="text-sm font-medium">{title}</p>
      {hint && (
        <p className="max-w-sm text-sm text-balance text-muted-foreground">
          {hint}
        </p>
      )}
      {action && <div className="pt-1">{action}</div>}
    </div>
  );
}
