"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/shared/ui/dialog";
import { cn } from "@/shared/lib/utils";
import type { Task } from "@/features/tasks/types";

/** The event the sidebar trigger fires — the palette lives inside the board
 *  (where the view/dialog state is), the trigger in the server-rendered shell,
 *  and a DOM event is the thinnest wire between the two. */
const OPEN_EVENT = "kanban:open-palette";

export interface PaletteCommand {
  id: string;
  label: string;
  /** Section header, rendered mockup-style as a `// label-mono` divider. */
  group: string;
  hint?: string;
  run: () => void;
}

/** Group → the glyph in the row's icon box. One place, so groups stay legible
 *  without threading icon components through every command definition. */
const GROUP_GLYPHS: Record<string, string> = {
  Views: "▦",
  Create: "+",
  Panels: "▸",
  Settings: "⚙",
  Tasks: "#",
};

interface CommandPaletteProps {
  commands: PaletteCommand[];
  /** The board's visible tasks — typing 2+ characters searches them too. */
  tasks: Task[];
  onOpenTask: (task: Task) => void;
}

export function CommandPalette({
  commands,
  tasks,
  onOpenTask,
}: CommandPaletteProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_EVENT, onOpen);
    };
  }, []);

  // Reset per open, not per close, so the closing animation never flashes an
  // emptied list.
  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
    }
  }, [open]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = q
      ? commands.filter((c) => c.label.toLowerCase().includes(q))
      : commands;
    // Tasks join the list once the query could plausibly name one — two
    // characters keeps "k" from listing half the board.
    const taskRows: PaletteCommand[] =
      q.length >= 2
        ? tasks
            .filter((t) => t.title.toLowerCase().includes(q))
            .slice(0, 8)
            .map((t) => ({
              id: `task-${t.id}`,
              label: t.title,
              group: "Tasks",
              hint: `#${t.id}`,
              run: () => onOpenTask(t),
            }))
        : [];
    return [...matched, ...taskRows];
  }, [commands, tasks, query, onOpenTask]);

  // Clamp rather than reset so arrowing near the end survives a keystroke that
  // shrinks the list.
  const activeIndex = Math.min(active, Math.max(0, results.length - 1));

  function runCommand(command: PaletteCommand) {
    setOpen(false);
    command.run();
  }

  function onInputKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % Math.max(1, results.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive(
        (i) => (i - 1 + Math.max(1, results.length)) % Math.max(1, results.length)
      );
    } else if (e.key === "Enter" && results[activeIndex]) {
      e.preventDefault();
      runCommand(results[activeIndex]);
    }
  }

  // Keep the active row on screen while arrowing through a scrolled list.
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  let lastGroup: string | null = null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        showCloseButton={false}
        className="top-[12vh] translate-y-0 gap-0 p-0 sm:max-w-[620px]"
        aria-label="Command palette"
      >
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <div className="flex items-center gap-3 border-b px-4 py-3.5">
          <Search className="size-4 shrink-0 text-neon-magenta" aria-hidden />
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onInputKeyDown}
            placeholder="Search tasks or run a command…"
            aria-label="Search tasks or run a command"
            className="flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
          />
          <kbd className="label-mono rounded-sm border bg-secondary px-1.5 py-0.5 text-muted-foreground">
            esc
          </kbd>
        </div>
        <div ref={listRef} className="max-h-[52vh] overflow-y-auto p-2">
          {results.length === 0 && (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              Nothing matches “{query}”.
            </p>
          )}
          {results.map((command, index) => {
            const header =
              command.group !== lastGroup ? command.group : null;
            lastGroup = command.group;
            return (
              <div key={command.id}>
                {/* The group name, not `// GroupName`: a comment marker is a
                    costume, and it reads as one the second time you see it.
                    label-mono already says "this is a label". */}
                {header && (
                  <div className="label-mono px-3 pt-2 pb-1 text-muted-foreground/70">
                    {header}
                  </div>
                )}
                <button
                  type="button"
                  data-index={index}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left",
                    index === activeIndex && "bg-accent"
                  )}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => runCommand(command)}
                >
                  <span
                    className="flex size-7 shrink-0 items-center justify-center rounded-md border border-primary/25 bg-primary/8 text-sm text-primary"
                    aria-hidden
                  >
                    {GROUP_GLYPHS[command.group] ?? "·"}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {command.label}
                  </span>
                  {command.hint && (
                    <span className="shrink-0 font-mono text-xs text-muted-foreground">
                      {command.hint}
                    </span>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** The sidebar's "Search / run command ⌘K" pill (mockup). Renders anywhere —
 *  it only fires the event; the palette itself lives with the board state. */
export function CommandPaletteTrigger() {
  return (
    <button
      type="button"
      className="flex w-full items-center gap-2 rounded-md border bg-secondary/50 px-2.5 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      onClick={() => window.dispatchEvent(new Event(OPEN_EVENT))}
    >
      <Search className="size-3.5 shrink-0" aria-hidden />
      <span className="flex-1 truncate text-left">Search / command</span>
      <kbd className="label-mono rounded-sm border border-primary/25 bg-primary/8 px-1.5 py-0.5 text-primary">
        ⌘K
      </kbd>
    </button>
  );
}
