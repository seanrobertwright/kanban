"use client";

import { BrushCleaning, Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { fetchBoard } from "@/features/board/client/api";
import type { Task } from "@/features/tasks/types";
import { Button } from "@/shared/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import type { Whiteboard } from "../types";
import { Select, SelectItem } from "@/shared/ui/select";

import { WhiteboardCanvas, type CanvasHandle } from "./whiteboard-canvas";
import type { SyncElement } from "../lib/sync";
type Element = SyncElement;
async function json<T>(response: Response): Promise<T> { if (!response.ok) throw new Error("Request failed"); return response.json() as Promise<T>; }

export function WhiteboardsButton({ boardId, canEdit }: { boardId: number; canEdit: boolean }) {
  const [open, setOpen] = useState(false);
  return <><Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setOpen(true)}><BrushCleaning /> Whiteboards</Button><WhiteboardsDialog boardId={boardId} canEdit={canEdit} open={open} onOpenChange={setOpen} /></>;
}

function WhiteboardsDialog({ boardId, canEdit, open, onOpenChange }: { boardId: number; canEdit: boolean; open: boolean; onOpenChange: (value: boolean) => void }) {
  const [boards, setBoards] = useState<Whiteboard[]>([]); const [selected, setSelected] = useState<Whiteboard | null>(null); const [title, setTitle] = useState(""); const [scene, setScene] = useState<Element[]>([]); const [tasks, setTasks] = useState<Task[]>([]); const [taskId, setTaskId] = useState("");
  // The canvas reads its seed once per mount and then owns the scene (its own
  // state while offline, the shared room's while live), so `scene` state exists
  // only to seed a mount and `sceneKey` remounts it when the *subject* changes —
  // choosing another canvas. Feeding scene reports back through setState is the
  // infinite-update loop this avoids: onChange → setState → render → onChange.
  const [sceneKey, setSceneKey] = useState(0);
  const sceneRef = useRef<Element[]>([]); const lastSavedRef = useRef(""); const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null); const selectedRef = useRef<Whiteboard | null>(null); const canvasRef = useRef<CanvasHandle | null>(null);
  useEffect(() => { if (!open) return; void Promise.all([fetch(`/api/board/${boardId}/whiteboards`, { cache: "no-store" }).then(json<Whiteboard[]>), fetchBoard(boardId)]).then(([whiteboards, board]) => { setBoards(whiteboards); choose(whiteboards[0] ?? null); setTasks(board.tasks); }).catch(() => undefined); }, [open, boardId]);
  // Closing flushes any pending debounced save so the last strokes are not lost.
  useEffect(() => { if (open) return; if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; void persist(sceneRef.current); } }, [open]);
  const taskOptions = useMemo(() => tasks.filter((task) => !task.parentId), [tasks]);
  function choose(board: Whiteboard | null) { const elements = (board?.scene ?? []) as Element[]; selectedRef.current = board; sceneRef.current = elements; lastSavedRef.current = JSON.stringify(elements); setSelected(board); setScene(elements); setSceneKey((k) => k + 1); }
  async function create() { if (!title.trim()) return; const board = await json<Whiteboard>(await fetch(`/api/board/${boardId}/whiteboards`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title }) })); setBoards((current) => [...current, board]); setTitle(""); choose(board); }
  async function persist(next: readonly Element[]) { const board = selectedRef.current; if (!board) return; const body = JSON.stringify(next); if (body === lastSavedRef.current) return; lastSavedRef.current = body; await fetch(`/api/whiteboards/${board.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scene: next }) }); }
  // Every scene the canvas reports (each pointer move while drawing) is stashed
  // in a ref — no setState, no re-render — and the PATCH is debounced so a stroke
  // saves once, not per pixel. `live` means a realtime room is holding this
  // canvas and persisting it (088): PATCHing on top of that would race the room
  // with a whole-scene write, exactly the clobber the room exists to prevent.
  // Not memoised: the canvas keeps this in a ref, so a fresh identity per render
  // costs nothing and a stale closure over `persist` would cost a save.
  function handleScene(elements: readonly Element[], live: boolean) {
    sceneRef.current = [...elements];
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    if (live) return;
    saveTimer.current = setTimeout(() => { saveTimer.current = null; void persist(sceneRef.current); }, 500);
  }
  // Handed to the canvas, not applied by remounting it: a remount would reseed
  // from `scene`, and a canvas already in a live room ignores its seed — so the
  // card would appear for a second and then be wiped by the room's own state.
  async function addTaskCard() { const task = taskOptions.find((item) => String(item.id) === taskId); if (!task || !canvasRef.current) return; const { convertToExcalidrawElements } = await import("@excalidraw/excalidraw"); const card = convertToExcalidrawElements([{ type: "rectangle", x: 80, y: 80, width: 300, height: 100, backgroundColor: "transparent", strokeColor: "#1e1e1e", customData: { taskId: task.id } }, { type: "text", x: 100, y: 110, text: `Task #${task.id}: ${task.title}`, fontSize: 20, customData: { taskId: task.id } }]) as unknown as Element[]; canvasRef.current.add(card); setTaskId(""); }
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-w-6xl"><DialogHeader><DialogTitle>Whiteboards</DialogTitle><DialogDescription>Excalidraw canvas saved to this board. Add task cards, draw, and arrange ideas.</DialogDescription></DialogHeader><div className="grid grid-cols-[11rem_1fr] gap-3"><aside className="grid content-start gap-2 border-r pr-3">{boards.map((board) => <button key={board.id} onClick={() => choose(board)} className={`rounded px-2 py-1 text-left text-sm ${selected?.id === board.id ? "bg-muted font-medium" : "hover:bg-muted"}`}>{board.title}</button>)}{canEdit && <div className="flex gap-1"><Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Board name" /><Button size="sm" onClick={() => void create()}>Add</Button></div>}</aside><section>{selected ? <><div className="mb-2 flex justify-end gap-2">{canEdit && <><Select aria-label="Task to add" className="h-8 rounded bg-background px-2" value={taskId} onValueChange={setTaskId}><SelectItem value="">Add task card…</SelectItem>{taskOptions.map((task) => <SelectItem key={task.id} value={String(task.id)}>#{task.id} {task.title}</SelectItem>)}</Select><Button size="sm" disabled={!taskId} onClick={() => void addTaskCard()}><Plus /> Task card</Button></>}</div><WhiteboardCanvas key={sceneKey} whiteboardId={selected.id} initialScene={scene} canEdit={canEdit} onScene={handleScene} onReady={(handle) => { canvasRef.current = handle; }} /></> : <p className="text-sm text-muted-foreground">Create a whiteboard.</p>}</section></div></DialogContent></Dialog>;
}
