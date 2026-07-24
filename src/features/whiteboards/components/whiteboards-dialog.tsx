"use client";

import { BrushCleaning, Plus } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { fetchBoard } from "@/features/board/client/api";
import type { Task } from "@/features/tasks/types";
import { Button } from "@/shared/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import type { Whiteboard } from "../types";

const Excalidraw = dynamic(() => import("@excalidraw/excalidraw").then((module) => module.Excalidraw), { ssr: false });
type Element = Record<string, unknown>;
async function json<T>(response: Response): Promise<T> { if (!response.ok) throw new Error("Request failed"); return response.json() as Promise<T>; }

export function WhiteboardsButton({ boardId, canEdit }: { boardId: number; canEdit: boolean }) {
  const [open, setOpen] = useState(false);
  return <><Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setOpen(true)}><BrushCleaning /> Whiteboards</Button><WhiteboardsDialog boardId={boardId} canEdit={canEdit} open={open} onOpenChange={setOpen} /></>;
}

function WhiteboardsDialog({ boardId, canEdit, open, onOpenChange }: { boardId: number; canEdit: boolean; open: boolean; onOpenChange: (value: boolean) => void }) {
  const [boards, setBoards] = useState<Whiteboard[]>([]); const [selected, setSelected] = useState<Whiteboard | null>(null); const [title, setTitle] = useState(""); const [scene, setScene] = useState<Element[]>([]); const [tasks, setTasks] = useState<Task[]>([]); const [taskId, setTaskId] = useState("");
  useEffect(() => { if (!open) return; void Promise.all([fetch(`/api/board/${boardId}/whiteboards`, { cache: "no-store" }).then(json<Whiteboard[]>), fetchBoard(boardId)]).then(([whiteboards, board]) => { setBoards(whiteboards); choose(whiteboards[0] ?? null); setTasks(board.tasks); }).catch(() => undefined); }, [open, boardId]);
  const taskOptions = useMemo(() => tasks.filter((task) => !task.parentId), [tasks]);
  function choose(board: Whiteboard | null) { setSelected(board); setScene((board?.scene ?? []) as Element[]); }
  async function create() { if (!title.trim()) return; const board = await json<Whiteboard>(await fetch(`/api/board/${boardId}/whiteboards`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title }) })); setBoards((current) => [...current, board]); setTitle(""); choose(board); }
  async function save(next: readonly Element[]) { const copy = [...next]; setScene(copy); if (selected) await fetch(`/api/whiteboards/${selected.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scene: copy }) }); }
  async function addTaskCard() { const task = taskOptions.find((item) => String(item.id) === taskId); if (!task) return; const { convertToExcalidrawElements } = await import("@excalidraw/excalidraw"); const card = convertToExcalidrawElements([{ type: "rectangle", x: 80, y: 80, width: 300, height: 100, backgroundColor: "transparent", strokeColor: "#1e1e1e", customData: { taskId: task.id } }, { type: "text", x: 100, y: 110, text: `Task #${task.id}: ${task.title}`, fontSize: 20, customData: { taskId: task.id } }]) as unknown as Element[]; await save([...scene, ...card]); setTaskId(""); }
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-w-6xl"><DialogHeader><DialogTitle>Whiteboards</DialogTitle><DialogDescription>Excalidraw canvas saved to this board. Add task cards, draw, and arrange ideas.</DialogDescription></DialogHeader><div className="grid grid-cols-[11rem_1fr] gap-3"><aside className="grid content-start gap-2 border-r pr-3">{boards.map((board) => <button key={board.id} onClick={() => choose(board)} className={`rounded px-2 py-1 text-left text-sm ${selected?.id === board.id ? "bg-muted font-medium" : "hover:bg-muted"}`}>{board.title}</button>)}{canEdit && <div className="flex gap-1"><Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Board name" /><Button size="sm" onClick={() => void create()}>Add</Button></div>}</aside><section>{selected ? <><div className="mb-2 flex justify-end gap-2">{canEdit && <><select aria-label="Task to add" className="rounded border bg-background px-2 text-sm" value={taskId} onChange={(event) => setTaskId(event.target.value)}><option value="">Add task card…</option>{taskOptions.map((task) => <option key={task.id} value={task.id}>#{task.id} {task.title}</option>)}</select><Button size="sm" disabled={!taskId} onClick={() => void addTaskCard()}><Plus /> Task card</Button></>}</div><div className="h-[32rem] overflow-hidden rounded border"><Excalidraw initialData={{ elements: scene as never[] }} viewModeEnabled={!canEdit} onChange={(elements) => { if (canEdit) void save(elements as unknown as Element[]); }} /></div></> : <p className="text-sm text-muted-foreground">Create a whiteboard.</p>}</section></div></DialogContent></Dialog>;
}
