"use client";

import { useEffect } from "react";
import type { LucideIcon } from "lucide-react";
import { Settings } from "lucide-react";

import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  InlineDialogHost,
} from "@/shared/ui/dialog";
import { cn } from "@/shared/lib/utils";

/**
 * The event the sidebar and the palette fire to open settings, optionally at a
 * section. The panel lives inside the board (where every configurable thing's
 * state already is) and the triggers live in the server-rendered shell, so a
 * DOM event is the thinnest wire between them — CommandPaletteTrigger's pattern.
 */
const OPEN_EVENT = "kanban:open-settings";

export function openSettings(section?: string) {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: section }));
}

export interface SettingsSection {
  id: string;
  label: string;
  /** Left-nav heading this section files under — "Workspace", "Board", "Planning". */
  group: string;
  icon: LucideIcon;
  /** One line under the title, saying what this section is for. */
  description?: string;
  /**
   * The panel. A thunk rather than an element so a section that is not showing
   * costs nothing — fifteen panels that each fetch on mount would otherwise all
   * fetch the moment settings opened.
   */
  render: () => React.ReactNode;
}

/**
 * One settings surface in place of fifteen scattered config dialogs.
 *
 * The panels themselves are unchanged: each was written as its own dialog, and
 * `InlineDialogHost` (shared/ui/dialog) makes the outermost Dialog beneath it
 * render as a plain region instead. So a panel is a modal when reached on its
 * own and a section when reached from here, with one implementation and no
 * modal-stacked-on-modal in either case.
 *
 * The nav is grouped by what you are configuring — the workspace, this board,
 * or the plan — rather than by the order the features happened to land in,
 * which is what the flat overflow menu was showing.
 */
export function SettingsDialog({
  sections,
  section,
  onSectionChange,
}: {
  sections: SettingsSection[];
  /** The open section's id, or null when the surface is closed. */
  section: string | null;
  onSectionChange: (section: string | null) => void;
}) {
  // The sidebar button and the ⌘K commands both arrive here.
  useEffect(() => {
    const onOpen = (e: Event) => {
      const wanted = (e as CustomEvent<string | undefined>).detail;
      onSectionChange(
        wanted && sections.some((s) => s.id === wanted)
          ? wanted
          : (sections[0]?.id ?? null)
      );
    };
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, [sections, onSectionChange]);

  const active = sections.find((s) => s.id === section) ?? null;

  // The groups in the order their sections were declared, so the caller decides
  // the nav's shape and this component never has to know the vocabulary.
  const groups: { name: string; items: SettingsSection[] }[] = [];
  for (const s of sections) {
    const existing = groups.find((g) => g.name === s.group);
    if (existing) existing.items.push(s);
    else groups.push({ name: s.group, items: [s] });
  }

  return (
    <Dialog
      open={section !== null}
      onOpenChange={(next) => {
        if (!next) onSectionChange(null);
      }}
    >
      {/* A wide slide-over, the task panel's shell: settings is a place you go
          to work for a minute, not a message to dismiss, and the board staying
          visible behind it is what keeps it from feeling like a mode. */}
      <DialogContent className="top-0 right-0 left-auto grid h-dvh max-h-dvh w-[min(980px,96vw)] max-w-none grid-rows-[auto_minmax(0,1fr)] translate-x-0 translate-y-0 gap-0 overflow-hidden rounded-none border-l p-0 sm:max-w-none data-open:zoom-in-100 data-closed:zoom-out-100 data-open:slide-in-from-right-16 data-closed:slide-out-to-right-16">
        <DialogHeader className="border-b px-5 py-4 pr-12">
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            {active?.description ??
              "Everything this workspace, board and plan are configured by."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 grid-cols-1 md:grid-cols-[13rem_minmax(0,1fr)]">
          {/* On a phone the nav becomes a scrolling strip above the panel: a
              13rem rail beside content would leave neither anything to work in. */}
          <nav
            aria-label="Settings sections"
            className="flex shrink-0 gap-1 overflow-x-auto border-b p-2 md:flex-col md:overflow-x-visible md:overflow-y-auto md:border-r md:border-b-0"
          >
            {groups.map((group) => (
              <div key={group.name} className="contents md:block">
                <div className="hidden px-2 pt-3 pb-1 text-meta font-semibold tracking-wider text-muted-foreground/70 uppercase md:block">
                  {group.name}
                </div>
                {group.items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onSectionChange(item.id)}
                    aria-current={item.id === section ? "page" : undefined}
                    className={cn(
                      "flex shrink-0 items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm whitespace-nowrap transition-colors md:w-full",
                      item.id === section
                        ? "bg-accent font-medium text-accent-foreground"
                        : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                    )}
                  >
                    <item.icon className="size-3.5 shrink-0" aria-hidden />
                    <span className="truncate">{item.label}</span>
                  </button>
                ))}
              </div>
            ))}
          </nav>

          <div className="min-h-0 overflow-y-auto p-5">
            {/* Only the showing section is rendered, and it is rendered inline:
                its own <Dialog> becomes a region, its header becomes the
                section's heading, and its footer sits at the bottom of this
                pane rather than floating over the board. */}
            {active ? (
              <InlineDialogHost key={active.id}>
                {active.render()}
              </InlineDialogHost>
            ) : (
              <p className="text-sm text-muted-foreground">
                Choose a section on the left.
              </p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** The sidebar's settings door. Renders anywhere — it only fires the event. */
export function SettingsTrigger({ section }: { section?: string }) {
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => openSettings(section)}
      title="Settings"
    >
      <Settings /> Settings
    </Button>
  );
}
