"use client"

import * as React from "react"
import { Select as SelectPrimitive } from "@base-ui/react/select"
import { CheckIcon, ChevronDownIcon } from "lucide-react"

import { cn } from "@/shared/lib/utils"

/**
 * A DOM-rendered replacement for the native `<select>`. The native popup is
 * painted by the OS, so it ignores the neon theme and can't be screenshotted;
 * this renders real elements we can style and test.
 *
 * The call shape deliberately mirrors the native one it replaced —
 * `<Select value onValueChange>` wrapping `<SelectItem value>` — so the
 * migration stayed mechanical across ~60 call sites.
 */

type ItemEntry = { label: React.ReactNode; value: unknown }

/**
 * Base UI's `<Select.Value>` renders the raw value unless Root is handed an
 * `items` map, which would show "task" instead of "Task". Rather than make
 * every call site repeat its options as a prop, we walk the children and
 * build that map from the `<SelectItem>`s already there.
 */
function collectItems(children: React.ReactNode, out: ItemEntry[]) {
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return

    if (child.type === SelectItem) {
      const { value, label, children: text } = child.props as SelectItemProps
      out.push({ value, label: label ?? text })
      return
    }
    // Groups and fragments are containers, not items — recurse through them.
    if (child.type === SelectGroup || child.type === React.Fragment) {
      collectItems(
        (child.props as { children?: React.ReactNode }).children,
        out
      )
    }
  })
}

export interface SelectProps
  extends Omit<
    SelectPrimitive.Root.Props<string>,
    "items" | "value" | "defaultValue" | "onValueChange"
  > {
  value?: string
  defaultValue?: string
  /**
   * Base UI can emit `null` when a selection is cleared, but every call site
   * here came from a native `<select>` whose value is always a string. The
   * wrapper normalises `null` to `""` so callers stay null-free.
   */
  onValueChange?: (
    value: string,
    eventDetails: SelectPrimitive.Root.ChangeEventDetails
  ) => void
  /** Applied to the trigger, matching where the native `<select>` wore it. */
  className?: string
  /** Applied to the popup, for width or max-height overrides. */
  contentClassName?: string
  placeholder?: React.ReactNode
  "aria-label"?: string
  "aria-labelledby"?: string
}

function Select({
  className,
  contentClassName,
  placeholder,
  children,
  disabled,
  onValueChange,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  ...props
}: SelectProps) {
  const items = React.useMemo(() => {
    const out: ItemEntry[] = []
    collectItems(children, out)
    return out
  }, [children])

  return (
    <SelectPrimitive.Root
      data-slot="select"
      items={items}
      disabled={disabled}
      onValueChange={(value, eventDetails) =>
        onValueChange?.(value ?? "", eventDetails)
      }
      {...props}
    >
      <SelectPrimitive.Trigger
        data-slot="select-trigger"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        className={cn(
          "inline-flex min-w-0 cursor-default items-center justify-between gap-1.5 rounded-lg border border-input bg-transparent px-2.5 text-left text-sm transition-colors outline-none select-none",
          "h-8 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
          "data-disabled:pointer-events-none data-disabled:opacity-50",
          /* No surface fill here: the compact inline triggers sit on the row
             they belong to. Field-style call sites add dark:bg-input/30. */
          className
        )}
      >
        <SelectPrimitive.Value
          data-slot="select-value"
          className="truncate"
          placeholder={placeholder}
        />
        <SelectPrimitive.Icon
          data-slot="select-icon"
          className="shrink-0 text-muted-foreground"
        >
          <ChevronDownIcon className="size-4" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Positioner
          className="isolate z-50 outline-none"
          sideOffset={4}
          /* Base UI defaults to overlaying the selected item on the trigger,
             mimicking a native macOS popup. These are form fields inside
             dialogs, so a plain dropdown below the trigger reads better. */
          alignItemWithTrigger={false}
        >
          <SelectPrimitive.Popup
            data-slot="select-content"
            className={cn(
              "z-50 max-h-(--available-height) min-w-(--anchor-width) origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-lg bg-popover p-1 text-popover-foreground shadow-lg ring-1 ring-foreground/15 duration-100 outline-none dark:ring-foreground/25",
              "data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2",
              "data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95",
              "data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
              contentClassName
            )}
          >
            <SelectPrimitive.List data-slot="select-list">
              {children}
            </SelectPrimitive.List>
          </SelectPrimitive.Popup>
        </SelectPrimitive.Positioner>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  )
}

export interface SelectItemProps
  extends Omit<SelectPrimitive.Item.Props, "value" | "label"> {
  /**
   * Typed as `string` rather than Base UI's `any`: matching is `Object.is`, so
   * a numeric value here against a string on the Root would silently fail to
   * select. Keeping both sides string makes that a compile error instead.
   */
  value?: string
  /** Only needed when the children aren't plain text. */
  label?: string
}

function SelectItem({ className, children, ...props }: SelectItemProps) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "relative flex cursor-default items-center gap-1.5 rounded-md py-1 pr-8 pl-1.5 text-sm outline-hidden select-none",
        "data-highlighted:bg-accent data-highlighted:text-accent-foreground",
        "data-disabled:pointer-events-none data-disabled:opacity-50",
        "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator
        data-slot="select-item-indicator"
        className="pointer-events-none absolute right-2 flex items-center justify-center text-primary"
      >
        <CheckIcon className="size-4" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  )
}

export interface SelectGroupProps extends SelectPrimitive.Group.Props {
  /** The `<optgroup label>` equivalent. */
  label?: React.ReactNode
}

function SelectGroup({ label, children, ...props }: SelectGroupProps) {
  return (
    <SelectPrimitive.Group data-slot="select-group" {...props}>
      {label != null && (
        <SelectPrimitive.GroupLabel
          data-slot="select-group-label"
          className="label-mono px-1.5 py-1 text-muted-foreground"
        >
          {label}
        </SelectPrimitive.GroupLabel>
      )}
      {children}
    </SelectPrimitive.Group>
  )
}

function SelectSeparator({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="select-separator"
      className={cn("-mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  )
}

export { Select, SelectItem, SelectGroup, SelectSeparator }
