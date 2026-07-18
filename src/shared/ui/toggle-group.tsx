"use client";

import { ToggleGroup as ToggleGroupPrimitive } from "@base-ui/react/toggle-group";
import { Toggle as TogglePrimitive } from "@base-ui/react/toggle";

import { cn } from "@/shared/lib/utils";

/**
 * A segmented control — base-ui's ToggleGroup wrapped shadcn-style, matching the
 * other primitives in this folder. Single-select by default (base-ui's
 * `multiple` defaults false), but the value is still an array on both sides, so
 * callers read `value[0]` and guard the empty case (clicking the pressed item
 * would otherwise deselect it).
 */
function ToggleGroup({
  className,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive>) {
  return (
    <ToggleGroupPrimitive
      data-slot="toggle-group"
      className={cn(
        "inline-flex items-center gap-0.5 rounded-lg border bg-muted/50 p-0.5",
        className
      )}
      {...props}
    />
  );
}

function ToggleGroupItem({
  className,
  ...props
}: React.ComponentProps<typeof TogglePrimitive>) {
  return (
    <TogglePrimitive
      data-slot="toggle-group-item"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm font-medium text-muted-foreground select-none outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-pressed:bg-background data-pressed:text-foreground data-pressed:shadow-sm data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4",
        className
      )}
      {...props}
    />
  );
}

export { ToggleGroup, ToggleGroupItem };
