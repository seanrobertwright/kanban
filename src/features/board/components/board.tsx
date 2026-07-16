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

import { Plus, Tags } from "lucide-react";

import { LabelsDialog } from "@/features/labels/components/labels-dialog";
import type { Label as LabelData } from "@/features/labels/types";
import * as tasksApi from "@/features/tasks/client/api";
import { TaskCard } from "@/features/tasks/components/task-card";
import {
  TaskDialog,
  type TaskFormValues,
} from "@/features/tasks/components/task-dialog";
import type { Task } from "@/features/tasks/types";
import type { Member } from "@/features/workspaces/types";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import * as boardApi from "../client/api";
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
  /** Everyone assignable on this board, and the source of every rendered face. */
  members: Member[];
  /**
   * The workspace's label vocabulary — the picker's options, and the source of
   * every chip's colour. Held in state rather than read straight from the prop
   * because the labels dialog can change it, and the board is what re-renders.
   */
  initialLabels: LabelData[];
  /** The vocabulary's owner — labels are workspace-scoped, not per board (007). */
  workspaceId: string;
  /** False for viewers. The server enforces this too — this only hides the UI. */
  canEdit: boolean;
  /**
   * Admin and up. Only deletion needs the extra rank: creating and renaming are
   * cheap and reversible, deleting can destroy work (§7.4's blast-radius rule,
   * applied to people). The server enforces both — these only hide the UI.
   */
  canDeleteColumns: boolean;
}

interface DialogState {
  columnId: number;
  task?: Task;
  /**
   * The parent, when the dialog is showing one of its subtasks. Set only while
   * navigated into a piece — it powers the "back" affordance and is why a piece
   * can be reached at all, since none of them are on the board (008).
   */
  parent?: Task;
}

export function Board({
  boardId,
  columns,
  initialTasks,
  members,
  initialLabels,
  workspaceId,
  canEdit,
  canDeleteColumns,
}: BoardProps) {
  // Columns are state now rather than a prop read straight through: they stopped
  // being seed data at M1 and the board edits them in place. page.tsx keys this
  // component by board id, so switching boards remounts rather than leaving this
  // state describing the board you just left.
  const [cols, setCols] = useState<Column[]>(columns);
  const [items, setItems] = useState<ItemsByColumn>(() =>
    groupTasks(columns, initialTasks)
  );
  const [error, setError] = useState<string | null>(null);
  const [addingColumn, setAddingColumn] = useState(false);
  const [newColumnTitle, setNewColumnTitle] = useState("");
  const columnNames = useMemo(
    () => Object.fromEntries(cols.map((c) => [c.id, c.title])),
    [cols]
  );
  const membersById = useMemo(
    () => Object.fromEntries(members.map((m) => [m.userId, m])),
    [members]
  );
  const [labels, setLabels] = useState<LabelData[]>(initialLabels);
  const [labelsOpen, setLabelsOpen] = useState(false);
  const labelsById = useMemo(
    () => Object.fromEntries(labels.map((l) => [l.id, l])),
    [labels]
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
      setCols(data.columns);
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

  async function handleAddColumn() {
    const title = newColumnTitle.trim();
    if (!title) return;
    try {
      const created = await boardApi.createColumn(boardId, title);
      setCols((prev) => [...prev, created]);
      setItems((prev) => ({ ...prev, [created.id]: [] }));
      setNewColumnTitle("");
      setAddingColumn(false);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add the column");
    }
  }

  function handleRenameColumn(column: Column, title: string) {
    setCols((prev) =>
      prev.map((c) => (c.id === column.id ? { ...c, title } : c))
    );
    boardApi.renameColumn(column.id, title).catch((e) => {
      setError(e instanceof Error ? e.message : "Could not rename the column");
      refresh();
    });
  }

  function handleMoveColumn(column: Column, by: -1 | 1) {
    const from = cols.findIndex((c) => c.id === column.id);
    const to = from + by;
    if (from === -1 || to < 0 || to >= cols.length) return;
    setCols((prev) => arrayMove(prev, from, to));
    boardApi.moveColumn(column.id, to).catch((e) => {
      setError(e instanceof Error ? e.message : "Could not move the column");
      refresh();
    });
  }

  /**
   * The one column mutation that is NOT optimistic, and deliberately.
   *
   * The server refuses to delete a column that still holds tasks — that 409 is
   * the expected answer, not an edge case. Removing the column on click and
   * putting it back a moment later would make the ordinary path look like a
   * glitch, and would flash the tasks out of existence on their way. So this
   * waits, and on refusal shows the server's sentence, which already says how
   * many tasks are in the way.
   */
  async function handleDeleteColumn(column: Column) {
    try {
      await boardApi.deleteColumn(column.id);
      setCols((prev) => prev.filter((c) => c.id !== column.id));
      setItems((prev) => {
        const next = { ...prev };
        delete next[column.id];
        return next;
      });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete the column");
    }
  }

  return (
    <>
      {error && (
        <p
          role="alert"
          className="rounded-lg border border-destructive/50 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      )}
      {/* Above the board, not inside a column: the vocabulary belongs to the
          workspace (007), so hanging it off a column's menu — where the column
          actions live — would say it belonged to this board. Viewers see it too;
          reading the vocabulary is not an edit, and the dialog hides its own
          controls. */}
      <div className="flex justify-end">
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={() => setLabelsOpen(true)}
        >
          <Tags /> Labels
        </Button>
      </div>
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
          {cols.map((column, index) => (
            <BoardColumn
              key={column.id}
              column={column}
              tasks={items[column.id] ?? []}
              membersById={membersById}
              labelsById={labelsById}
              canEdit={canEdit}
              canDelete={canDeleteColumns}
              isFirst={index === 0}
              isLast={index === cols.length - 1}
              onAddTask={() => setDialog({ columnId: column.id })}
              onEditTask={(task) =>
                setDialog({ columnId: task.columnId, task })
              }
              onDeleteTask={handleDelete}
              onRename={(title) => handleRenameColumn(column, title)}
              onMove={(by) => handleMoveColumn(column, by)}
              onDelete={() => handleDeleteColumn(column)}
            />
          ))}
          {canEdit && (
            <div className="w-72 shrink-0">
              {addingColumn ? (
                <div className="grid gap-1.5 rounded-xl border bg-muted/50 p-2">
                  <Input
                    value={newColumnTitle}
                    autoFocus
                    aria-label="New column title"
                    placeholder="Column name"
                    className="h-8"
                    onChange={(e) => setNewColumnTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void handleAddColumn();
                      if (e.key === "Escape") {
                        setNewColumnTitle("");
                        setAddingColumn(false);
                      }
                    }}
                  />
                  <div className="flex gap-1.5">
                    <Button
                      size="sm"
                      disabled={!newColumnTitle.trim()}
                      onClick={handleAddColumn}
                    >
                      Add
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setNewColumnTitle("");
                        setAddingColumn(false);
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start text-muted-foreground"
                  onClick={() => setAddingColumn(true)}
                >
                  <Plus /> Add column
                </Button>
              )}
            </div>
          )}
        </div>
        <DragOverlay>
          {activeTask ? (
            <TaskCard
              task={activeTask}
              membersById={membersById}
              labelsById={labelsById}
            />
          ) : null}
        </DragOverlay>
      </DndContext>
      <TaskDialog
        open={dialog !== null}
        task={dialog?.task}
        parentTask={dialog?.parent}
        columnNames={columnNames}
        columns={cols}
        members={members}
        labels={labels}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        onSubmit={handleDialogSubmit}
        // Opening a piece keeps the dialog open and swaps the task inside it,
        // stashing the current one as the parent to return to. Depth is 1, so the
        // task being opened is always top-level — there is no deeper stack.
        onOpenSubtask={(sub) =>
          setDialog((prev) => ({
            columnId: sub.columnId,
            task: sub,
            parent: prev?.task,
          }))
        }
        onBack={() =>
          setDialog((prev) =>
            prev?.parent
              ? { columnId: prev.parent.columnId, task: prev.parent }
              : prev
          )
        }
        // A piece's status is a move, committed when made. A large position
        // appends it to the destination column's pieces; the server clamps. On
        // failure the board refetches, which also reconciles the parent's count.
        onMoveSubtask={(id, columnId) =>
          tasksApi
            .moveTask(id, { columnId, position: Number.MAX_SAFE_INTEGER })
            .catch(refresh)
        }
        // Adding or removing a piece changes the parent's count, which the card
        // renders — so the board is stale and refetches.
        onSubtasksChanged={refresh}
      />
      <LabelsDialog
        open={labelsOpen}
        workspaceId={workspaceId}
        labels={labels}
        canEdit={canEdit}
        canDelete={canDeleteColumns}
        onOpenChange={setLabelsOpen}
        onChanged={(next) => {
          setLabels(next);
          // The vocabulary changed, so the tasks may have too: deleting a label
          // unlabels every task wearing it, and a rename changes what their
          // chips say. Both are server-side facts this board is now stale about.
          void refresh();
        }}
      />
    </>
  );
}
