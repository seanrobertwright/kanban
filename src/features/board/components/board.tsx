"use client";

import { useCallback, useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";

import * as tasksApi from "@/features/tasks/client/api";
import { TaskCard } from "@/features/tasks/components/task-card";
import {
  TaskDialog,
  type TaskFormValues,
} from "@/features/tasks/components/task-dialog";
import type { Task } from "@/features/tasks/types";
import { fetchBoard } from "../client/api";
import type { Column } from "../types";
import { BoardColumn } from "./board-column";

type ItemsByColumn = Record<number, Task[]>;

function groupTasks(columns: Column[], tasks: Task[]): ItemsByColumn {
  const grouped: ItemsByColumn = {};
  for (const column of columns) grouped[column.id] = [];
  for (const task of tasks) grouped[task.columnId]?.push(task);
  for (const id in grouped) {
    grouped[id].sort((a, b) => a.position - b.position);
  }
  return grouped;
}

interface BoardProps {
  boardId: number;
  columns: Column[];
  initialTasks: Task[];
  /** False for viewers. The server enforces this too — this only hides the UI. */
  canEdit: boolean;
}

interface DialogState {
  columnId: number;
  task?: Task;
}

export function Board({ boardId, columns, initialTasks, canEdit }: BoardProps) {
  const [items, setItems] = useState<ItemsByColumn>(() =>
    groupTasks(columns, initialTasks)
  );
  const columnNames = useMemo(
    () => Object.fromEntries(columns.map((c) => [c.id, c.title])),
    [columns]
  );
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [dialog, setDialog] = useState<DialogState | null>(null);

  const sensors = useSensors(
    // The distance constraint lets plain clicks reach buttons inside cards
    // instead of being swallowed as drag starts.
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const refresh = useCallback(async () => {
    try {
      const data = await fetchBoard(boardId);
      setItems(groupTasks(data.columns, data.tasks));
    } catch {
      // Keep optimistic state if the server is unreachable.
    }
  }, [boardId]);

  function findColumnId(dndId: string): number | undefined {
    if (dndId.startsWith("col-")) return Number(dndId.slice(4));
    const taskId = Number(dndId.slice(5));
    for (const [columnId, tasks] of Object.entries(items)) {
      if (tasks.some((t) => t.id === taskId)) return Number(columnId);
    }
    return undefined;
  }

  function handleDragStart(event: DragStartEvent) {
    const id = String(event.active.id);
    const columnId = findColumnId(id);
    if (columnId === undefined) return;
    const task = items[columnId].find((t) => `task-${t.id}` === id) ?? null;
    setActiveTask(task);
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);

    const sourceColumnId = findColumnId(activeId);
    const targetColumnId = findColumnId(overId);
    if (
      sourceColumnId === undefined ||
      targetColumnId === undefined ||
      sourceColumnId === targetColumnId
    ) {
      return;
    }

    // Move the task into the hovered column locally; positions are
    // persisted once on drag end.
    setItems((prev) => {
      const source = [...prev[sourceColumnId]];
      const target = [...prev[targetColumnId]];
      const fromIndex = source.findIndex((t) => `task-${t.id}` === activeId);
      if (fromIndex === -1) return prev;
      const [task] = source.splice(fromIndex, 1);
      const overIndex = overId.startsWith("col-")
        ? target.length
        : target.findIndex((t) => `task-${t.id}` === overId);
      const insertAt = overIndex === -1 ? target.length : overIndex;
      target.splice(insertAt, 0, { ...task, columnId: targetColumnId });
      return { ...prev, [sourceColumnId]: source, [targetColumnId]: target };
    });
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveTask(null);
    const { active, over } = event;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);

    // By drag end, handleDragOver has already parked the task in its
    // destination column — only in-column reordering remains.
    const columnId = findColumnId(activeId);
    if (columnId === undefined) return;
    const columnTasks = items[columnId];
    const fromIndex = columnTasks.findIndex(
      (t) => `task-${t.id}` === activeId
    );
    if (fromIndex === -1) return;

    let toIndex = fromIndex;
    if (!overId.startsWith("col-") && overId !== activeId) {
      const overIndex = columnTasks.findIndex(
        (t) => `task-${t.id}` === overId
      );
      if (overIndex !== -1) toIndex = overIndex;
    }

    if (fromIndex !== toIndex) {
      setItems((prev) => ({
        ...prev,
        [columnId]: arrayMove(prev[columnId], fromIndex, toIndex),
      }));
    }

    const task = columnTasks[fromIndex];
    tasksApi
      .moveTask(task.id, { columnId, position: toIndex })
      .catch(refresh);
  }

  async function handleDialogSubmit(values: TaskFormValues) {
    if (!dialog) return;
    try {
      if (dialog.task) {
        const updated = await tasksApi.updateTask(dialog.task.id, values);
        setItems((prev) => ({
          ...prev,
          [updated.columnId]: (prev[updated.columnId] ?? []).map((t) =>
            t.id === updated.id ? { ...t, ...updated } : t
          ),
        }));
      } else {
        const created = await tasksApi.createTask({
          columnId: dialog.columnId,
          ...values,
        });
        setItems((prev) => ({
          ...prev,
          [created.columnId]: [...(prev[created.columnId] ?? []), created],
        }));
      }
      setDialog(null);
    } catch {
      refresh();
      setDialog(null);
    }
  }

  function handleDelete(task: Task) {
    setItems((prev) => ({
      ...prev,
      [task.columnId]: (prev[task.columnId] ?? []).filter(
        (t) => t.id !== task.id
      ),
    }));
    tasksApi.deleteTask(task.id).catch(refresh);
  }

  return (
    <>
      <DndContext
        id="board-dnd"
        // No sensors means nothing can start a drag — the read-only path.
        sensors={canEdit ? sensors : []}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveTask(null)}
      >
        <div className="flex items-start gap-4 overflow-x-auto pb-4">
          {columns.map((column) => (
            <BoardColumn
              key={column.id}
              column={column}
              tasks={items[column.id] ?? []}
              canEdit={canEdit}
              onAddTask={() => setDialog({ columnId: column.id })}
              onEditTask={(task) =>
                setDialog({ columnId: task.columnId, task })
              }
              onDeleteTask={handleDelete}
            />
          ))}
        </div>
        <DragOverlay>
          {activeTask ? <TaskCard task={activeTask} /> : null}
        </DragOverlay>
      </DndContext>
      <TaskDialog
        open={dialog !== null}
        task={dialog?.task}
        columnNames={columnNames}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        onSubmit={handleDialogSubmit}
      />
    </>
  );
}
