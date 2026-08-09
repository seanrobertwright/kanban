"use client";

import { BrushCleaning, Plus, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import { fetchBoard } from "@/features/board/client/api";
import type { Task } from "@/features/tasks/types";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Select, SelectItem } from "@/shared/ui/select";
import type { Whiteboard } from "../types";
import type { SyncElement } from "../lib/sync";
import {
  createTaskCardElements,
  WhiteboardCanvas,
} from "./whiteboard-canvas";
import type { CanvasHandle } from "./whiteboard-canvas";

const OPEN_EVENT = "kanban:open-whiteboards";

type Element = SyncElement;
type OpenWhiteboardsDetail = { trigger?: HTMLButtonElement };

async function json<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error("Request failed");
  return response.json() as Promise<T>;
}

function restoreTriggerFocus(preferred: HTMLButtonElement | null) {
  const candidates = [
    preferred,
    ...document.querySelectorAll<HTMLButtonElement>(
      '[data-whiteboards-trigger="true"]'
    ),
  ];
  for (const candidate of candidates) {
    if (!candidate?.isConnected || candidate.disabled) continue;
    candidate.focus();
    if (document.activeElement === candidate) return;
  }
}

/** Opens the whiteboard workspace from the sidebar or compact mobile tools. */
export function openWhiteboards(trigger?: HTMLButtonElement) {
  window.dispatchEvent(
    new CustomEvent<OpenWhiteboardsDetail>(OPEN_EVENT, {
      detail: { trigger },
    })
  );
}

/** The sidebar door. The surface itself lives beside the board content. */
export function WhiteboardsButton() {
  return (
    <Button
      variant="ghost"
      size="sm"
      className="text-muted-foreground"
      data-whiteboards-trigger="true"
      onClick={(event) => openWhiteboards(event.currentTarget)}
    >
      <BrushCleaning /> Whiteboards
    </Button>
  );
}

/**
 * A first-class workspace surface, not a modal.
 *
 * It replaces only the board area, so the workspace header and sidebar remain
 * visible. The board stays mounted but hidden while the canvas is open, which
 * preserves filters, view selection, and local task state for the return trip.
 */
export function WhiteboardsWorkspace({
  boardId,
  canEdit,
  children,
}: {
  boardId: number;
  canEdit: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [boards, setBoards] = useState<Whiteboard[]>([]);
  const [selected, setSelected] = useState<Whiteboard | null>(null);
  const [title, setTitle] = useState("");
  const [scene, setScene] = useState<Element[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [taskId, setTaskId] = useState("");
  const [sceneKey, setSceneKey] = useState(0);
  const [loading, setLoading] = useState(false);

  const sceneRef = useRef<Element[]>([]);
  const lastSavedRef = useRef("");
  const saveTimer = useRef<number | undefined>(undefined);
  const selectedRef = useRef<Whiteboard | null>(null);
  const canvasRef = useRef<CanvasHandle | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  const choose = useCallback((board: Whiteboard | null) => {
    const elements = (board?.scene ?? []) as Element[];
    selectedRef.current = board;
    sceneRef.current = elements;
    lastSavedRef.current = JSON.stringify(elements);
    setSelected(board);
    setScene(elements);
    setSceneKey((key) => key + 1);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    window.requestAnimationFrame(() =>
      restoreTriggerFocus(triggerRef.current)
    );
  }, []);

  useEffect(() => {
    const onOpen = (event: Event) => {
      triggerRef.current =
        (event as CustomEvent<OpenWhiteboardsDetail>).detail?.trigger ?? null;
      setLoading(true);
      setOpen(true);
    };
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, []);

  useEffect(() => {
    if (!open) return;
    window.requestAnimationFrame(() => closeRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [close, open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void Promise.all([
      fetch(`/api/board/${boardId}/whiteboards`, { cache: "no-store" }).then(
        json<Whiteboard[]>
      ),
      fetchBoard(boardId),
    ])
      .then(([whiteboards, board]) => {
        if (cancelled) return;
        setBoards(whiteboards);
        choose(whiteboards[0] ?? null);
        setTasks(board.tasks);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [boardId, choose, open]);

  const persist = useCallback(async (next: readonly Element[]) => {
    const board = selectedRef.current;
    if (!board) return;
    const body = JSON.stringify(next);
    if (body === lastSavedRef.current) return;
    lastSavedRef.current = body;
    await fetch(`/api/whiteboards/${board.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scene: next }),
    });
  }, []);

  useEffect(() => {
    if (open || saveTimer.current === undefined) return;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = undefined;
    void persist(sceneRef.current);
  }, [open, persist]);

  const taskOptions = useMemo(
    () => tasks.filter((task) => !task.parentId),
    [tasks]
  );

  async function create() {
    if (!title.trim()) return;
    const board = await json<Whiteboard>(
      await fetch(`/api/board/${boardId}/whiteboards`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      })
    );
    setBoards((current) => [...current, board]);
    setTitle("");
    choose(board);
  }

  function handleScene(elements: readonly Element[], live: boolean) {
    sceneRef.current = [...elements];
    window.clearTimeout(saveTimer.current);
    saveTimer.current = undefined;
    if (live) return;
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = undefined;
      void persist(sceneRef.current);
    }, 500);
  }

  async function addTaskCard() {
    const task = taskOptions.find((item) => String(item.id) === taskId);
    if (!task || !canvasRef.current) return;
    const card = await createTaskCardElements(task);
    canvasRef.current.add(card);
    setTaskId("");
  }

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1">
      <div
        className={cn(
          "flex min-w-0 flex-1 flex-col",
          open && "hidden"
        )}
        aria-hidden={open || undefined}
      >
        {children}
      </div>

      {open && (
        <section
          aria-labelledby="whiteboards-heading"
          data-suppress-board-shortcuts="true"
          className="absolute -inset-5 z-30 flex min-h-0 flex-col overflow-hidden bg-background"
        >
          <div className="flex min-h-14 shrink-0 items-center gap-3 border-b px-4 py-2">
            <div className="min-w-0">
              <h2 id="whiteboards-heading" className="font-heading font-semibold">
                Whiteboards
              </h2>
              <p className="hidden truncate text-xs text-muted-foreground sm:block">
                Draw together, arrange ideas, and place live task cards.
              </p>
            </div>
            <Button
              ref={closeRef}
              type="button"
              variant="ghost"
              size="icon-sm"
              className="ml-auto shrink-0"
              aria-label="Close whiteboards"
              title="Close whiteboards"
              onClick={close}
            >
              <X />
            </Button>
          </div>

          <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] md:grid-cols-[14rem_minmax(0,1fr)] md:grid-rows-1">
            <aside
              aria-label="Whiteboards"
              className="flex shrink-0 gap-1 overflow-x-auto border-b bg-muted/20 p-2 md:flex-col md:overflow-x-hidden md:overflow-y-auto md:border-r md:border-b-0"
            >
              <div className="flex gap-1 md:flex-col">
                {boards.map((board) => (
                  <button
                    key={board.id}
                    type="button"
                    onClick={() => choose(board)}
                    aria-current={selected?.id === board.id ? "page" : undefined}
                    className={cn(
                      "max-w-48 shrink-0 truncate rounded-md px-2.5 py-2 text-left text-sm transition-colors md:max-w-none",
                      selected?.id === board.id
                        ? "bg-accent font-medium text-accent-foreground"
                        : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                    )}
                  >
                    {board.title}
                  </button>
                ))}
              </div>

              {canEdit && (
                <div className="flex min-w-56 gap-1 border-l pl-2 md:mt-auto md:min-w-0 md:border-t md:border-l-0 md:pt-3 md:pl-0">
                  <Input
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    placeholder="Board name"
                    aria-label="New whiteboard name"
                  />
                  <Button
                    type="button"
                    size="sm"
                    disabled={!title.trim()}
                    onClick={() => void create()}
                  >
                    Add
                  </Button>
                </div>
              )}
            </aside>

            <div className="flex min-h-0 min-w-0 flex-col">
              {selected ? (
                <>
                  <div className="flex min-h-12 shrink-0 items-center gap-2 border-b px-3 py-2">
                    <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">
                      {selected.title}
                    </h3>
                    {canEdit && (
                      <>
                        <Select
                          aria-label="Task to add"
                          className="h-8 min-w-0 max-w-72 rounded bg-background px-2"
                          value={taskId}
                          onValueChange={setTaskId}
                        >
                          <SelectItem value="">Add task card…</SelectItem>
                          {taskOptions.map((task) => (
                            <SelectItem key={task.id} value={String(task.id)}>
                              #{task.id} {task.title}
                            </SelectItem>
                          ))}
                        </Select>
                        <Button
                          type="button"
                          size="sm"
                          disabled={!taskId}
                          onClick={() => void addTaskCard()}
                        >
                          <Plus />
                          <span className="hidden sm:inline">Task card</span>
                        </Button>
                      </>
                    )}
                  </div>
                  <div className="min-h-0 flex-1">
                    <WhiteboardCanvas
                      key={sceneKey}
                      whiteboardId={selected.id}
                      initialScene={scene}
                      canEdit={canEdit}
                      onScene={handleScene}
                      onReady={(handle) => {
                        canvasRef.current = handle;
                      }}
                    />
                  </div>
                </>
              ) : (
                <div className="grid min-h-0 flex-1 place-items-center p-6 text-center">
                  <div>
                    <BrushCleaning
                      className="mx-auto mb-3 size-8 text-muted-foreground"
                      aria-hidden
                    />
                    <p className="font-medium">
                      {loading
                        ? "Loading whiteboards…"
                        : canEdit
                          ? "Create a whiteboard"
                          : "No whiteboards yet"}
                    </p>
                    {!loading && (
                      <p className="mt-1 text-sm text-muted-foreground">
                        {canEdit
                          ? "Name the first canvas in the rail, then start drawing."
                          : "An editor can create the first canvas for this board."}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
