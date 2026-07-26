"use client"

import * as React from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"

import { cn } from "@/shared/lib/utils"
import { Button } from "@/shared/ui/button"
import { XIcon } from "lucide-react"

/**
 * Inline mode: "the next Dialog below me is not a dialog".
 *
 * The Settings surface hosts ~15 feature panels that were each written as their
 * own dialog, and stacking them inside another dialog is the modal-in-modal the
 * design review called out. Rewriting fifteen components to split "the panel"
 * from "the dialog around it" would be fifteen chances to change behaviour; this
 * inverts it — the primitive learns to render as a plain region, and every panel
 * works unchanged in both places.
 *
 * Consumed and cleared: `Dialog` reads this flag and immediately provides
 * `false` to everything beneath it, so only the outermost Dialog under a host
 * goes inline. A panel that opens a confirm dialog of its own still gets a real
 * modal — which is the correct answer, because *that* one is a modal.
 */
const InlineDialogContext = React.createContext(false)

/** The inline surface's own close, standing in for DialogPrimitive.Close —
 *  there is no Root to ask, so the handler has to be carried down. */
const InlineCloseContext = React.createContext<(() => void) | null>(null)

function InlineDialogHost({ children }: { children: React.ReactNode }) {
  return (
    <InlineDialogContext.Provider value={true}>
      {children}
    </InlineDialogContext.Provider>
  )
}

function Dialog({ children, ...props }: DialogPrimitive.Root.Props) {
  const inline = React.useContext(InlineDialogContext)
  const onOpenChange = props.onOpenChange
  // Narrowed to a bare "close me": base-ui's handler also takes an event-details
  // argument the inline surface has nothing to supply, and no panel reads it.
  const inlineClose = React.useMemo(
    () => (onOpenChange ? () => onOpenChange(false, undefined!) : null),
    [onOpenChange]
  )
  if (inline) {
    // `open` is the panel's own visibility, and inline it is the host that
    // decides what is on screen — but a panel rendered with open={false} still
    // means "not now", so it is honoured rather than ignored.
    if (props.open === false) return null
    return (
      <InlineDialogContext.Provider value={false}>
        <InlineCloseContext.Provider value={inlineClose}>
          {children as React.ReactNode}
        </InlineCloseContext.Provider>
      </InlineDialogContext.Provider>
    )
  }
  return (
    <DialogPrimitive.Root data-slot="dialog" {...props}>
      {/* Clearing the close handler matters as much as clearing the flag: a
          panel that opens a confirm dialog of its own renders that Dialog
          inside the inline subtree, and without this its content would still
          see an inline close in context and render as a region — a destructive
          confirm silently demoted to a paragraph. */}
      <InlineCloseContext.Provider value={null}>
        {children as React.ReactNode}
      </InlineCloseContext.Provider>
    </DialogPrimitive.Root>
  )
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  const close = React.useContext(InlineCloseContext)
  const inline = React.useContext(InlineDialogContext)
  // Inside an inline panel there is no Root to close, so the handler carried
  // down does the job. `inline` is already false here (Dialog cleared it), so
  // the presence of a close handler is what distinguishes the two.
  if (!inline && close) {
    // `render` is base-ui's slot mechanism and means nothing to a plain button,
    // so it is dropped rather than forwarded into a DOM-prop warning; the
    // outline Button is what every render target here was anyway.
    const { render: _render, children, ...rest } = props
    return (
      <Button
        type="button"
        variant="outline"
        data-slot="dialog-close"
        onClick={close}
        {...(rest as React.ComponentProps<typeof Button>)}
      >
        {children as React.ReactNode}
      </Button>
    )
  }
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 isolate z-50 bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs dark:bg-[rgba(2,4,10,0.65)] data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean
}) {
  const close = React.useContext(InlineCloseContext)
  const inline = React.useContext(InlineDialogContext)
  if (!inline && close) {
    // The panel's className is positioning for a popup — `fixed top-1/2`,
    // `sm:max-w-2xl`, slide-over overrides — none of which mean anything to a
    // region inside a page. Dropping it is deliberate: honouring half of it
    // would produce a panel anchored to the viewport inside a scrolling host.
    return (
      <div data-slot="dialog-content" className="grid gap-4 text-sm">
        {children}
      </div>
    )
  }
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={cn(
          // max-height + internal scroll, so a dialog taller than the viewport
          // scrolls inside itself rather than overflowing off the top — where a
          // centered popup would otherwise put its header out of reach. The task
          // dialog is the one that hits this: status, subtasks, comments and
          // history stack well past a short viewport.
          "fixed top-1/2 left-1/2 z-50 grid max-h-[calc(100dvh-2rem)] w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-xl bg-popover p-4 text-sm text-popover-foreground ring-1 ring-foreground/10 duration-100 outline-none sm:max-w-sm dark:ring-primary/35 dark:shadow-[0_24px_70px_rgba(0,229,255,0.18)] data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            render={
              <Button
                variant="ghost"
                className="absolute top-2 right-2"
                size="icon-sm"
              />
            }
          >
            <XIcon
            />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  const close = React.useContext(InlineCloseContext)
  const inline = React.useContext(InlineDialogContext)
  const isInline = !inline && close != null
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 border-t p-4 sm:flex-row sm:justify-end",
        // The bleed and the rounded corner exist to meet a popup's padded edge.
        // Inline there is no edge to meet, and the negative margins would pull
        // the footer out through the host's own padding.
        isInline
          ? "-mx-3 -mb-3 mt-2"
          : "-mx-4 -mb-4 rounded-b-xl bg-muted/50",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogClose render={<Button variant="outline" />}>Close</DialogClose>
      )}
    </div>
  )
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  const close = React.useContext(InlineCloseContext)
  const inline = React.useContext(InlineDialogContext)
  if (!inline && close) {
    // A real heading, not a labelled popup title: inline there is no dialog for
    // it to name, and h2 is what a section of a page wants for its outline.
    return (
      <h2
        data-slot="dialog-title"
        className={cn(
          "font-heading text-base leading-none font-medium",
          className
        )}
        {...(props as React.ComponentProps<"h2">)}
      />
    )
  }
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(
        "font-heading text-base leading-none font-medium",
        className
      )}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: DialogPrimitive.Description.Props) {
  const close = React.useContext(InlineCloseContext)
  const inline = React.useContext(InlineDialogContext)
  if (!inline && close) {
    return (
      <p
        data-slot="dialog-description"
        className={cn(
          "text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
          className
        )}
        {...(props as React.ComponentProps<"p">)}
      />
    )
  }
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
  InlineDialogHost,
}
