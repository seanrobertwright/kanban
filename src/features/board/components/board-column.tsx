"use client";

import { useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import {
  ArrowLeft,
  ArrowRight,
  CircleCheck,
  Gauge,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";

import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { Input } from "@/shared/ui/input";
import type { Task } from "@/features/tasks/types";
import type { AgentSummary } from "@/features/agents/types";
import type { Label as LabelData } from "@/features/labels/types";
import type { Member } from "@/features/workspaces/types";
import type { Column } from "../types";
import { SortableTaskCard } from "./sortable-task-card";

interface BoardColumnProps {
  column: Column;
  tasks: Task[];
  membersById: Record<string, Member>;
  /** Agents by id (011), for resolving an agent assignee's name and face. */
  agentsById: Record<string, AgentSummary>;
  /** Labels by id, for chip colour. The task carries its own names (LabelRef). */
  labelsById: Record<number, LabelData>;
  /** Member and up: add a task, add/rename/reorder a column. */
  canEdit: boolean;
  /** Admin and up. Deleting can destroy work, so it is gated harder (§7.4). */
  canDelete: boolean;
  /** This is the board's done column (020) — a recurring task moved here recurs. */
  isDone: boolean;
  isFirst: boolean;
  isLast: boolean;
  onAddTask: () => void;
  onEditTask: (task: Task) => void;
  onDeleteTask: (task: Task) => void;
  onRename: (title: string) => void;
  /** Set or clear (null) this column's WIP limit (023). Member, like rename. */
  onSetWipLimit: (limit: number | null) => void;
  onMove: (by: -1 | 1) => void;
  onDelete: () => void;
  /** Toggle whether this is the done column. Admin-only, like delete (§7.4). */
  onToggleDone: () => void;
}

export function BoardColumn({
  column,
  tasks,
  membersById,
  agentsById,
  labelsById,
  canEdit,
  canDelete,
  isDone,
  isFirst,
  isLast,
  onAddTask,
  onEditTask,
  onDeleteTask,
  onRename,
  onSetWipLimit,
  onMove,
  onDelete,
  onToggleDone,
}: BoardColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: `col-${column.id}` });
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(column.title);
  // The WIP-limit editor, renaming's twin: the header swaps to a number input,
  // Enter commits, Escape abandons, and emptying the field clears the limit.
  const [limiting, setLimiting] = useState(false);
  const [limitDraft, setLimitDraft] = useState("");

  function commitRename() {
    const title = draft.trim();
    setRenaming(false);
    // An empty title is a slip, not an intent: put the old one back rather than
    // sending a rename the server would refuse anyway.
    if (!title || title === column.title) {
      setDraft(column.title);
      return;
    }
    onRename(title);
  }

  function commitLimit() {
    setLimiting(false);
    // "" clears — no limit is a real state, unlike an empty title. Anything
    // unparseable or < 1 is a slip and changes nothing.
    if (limitDraft.trim() === "") {
      if (column.wipLimit !== null) onSetWipLimit(null);
      return;
    }
    const limit = parseInt(limitDraft, 10);
    if (!Number.isInteger(limit) || limit < 1 || limit === column.wipLimit)
      return;
    onSetWipLimit(limit);
  }

  const overLimit = column.wipLimit !== null && tasks.length > column.wipLimit;

  return (
    <section className="flex w-72 shrink-0 flex-col rounded-xl border bg-muted/50">
      <header className="flex items-center justify-between gap-1 px-3 py-2.5">
        {renaming ? (
          <Input
            value={draft}
            autoFocus
            aria-label="Column title"
            className="h-7 text-sm font-semibold"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              // Escape abandons the edit, which is why the draft resets here
              // rather than in commitRename alone.
              if (e.key === "Escape") {
                setDraft(column.title);
                setRenaming(false);
              }
            }}
          />
        ) : (
          <>
            <h2 className="flex items-center gap-1 truncate text-sm font-semibold" title={column.title}>
              {/* The completion column (020). The check marks it at a glance; the
                  label carries the meaning for anyone who cannot see the icon, and
                  the title says what dropping a recurring card here does. */}
              {isDone && (
                <span title="Done column — a recurring task moved here spawns the next one">
                  <CircleCheck
                    className="size-3.5 shrink-0 text-primary"
                    aria-label="Done column"
                  />
                </span>
              )}
              <span className="truncate">{column.title}</span>
            </h2>
            {limiting ? (
              <Input
                value={limitDraft}
                autoFocus
                type="number"
                min={1}
                aria-label={`WIP limit for ${column.title}`}
                placeholder="No limit"
                className="h-7 w-20 text-sm"
                onChange={(e) => setLimitDraft(e.target.value)}
                onBlur={commitLimit}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitLimit();
                  if (e.key === "Escape") setLimiting(false);
                }}
              />
            ) : (
              /* Count against limit (023) — "4/3" in the destructive red when
                 over, which is the whole enforcement: loud, not blocking. The
                 sr-only text says it for anyone who cannot see the colour. */
              <span
                className={cn(
                  "rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums",
                  overLimit
                    ? "font-medium text-destructive"
                    : "text-muted-foreground"
                )}
                title={
                  column.wipLimit === null
                    ? `${tasks.length} task${tasks.length === 1 ? "" : "s"}`
                    : overLimit
                      ? `Over the WIP limit: ${tasks.length} of ${column.wipLimit}`
                      : `${tasks.length} of a ${column.wipLimit}-task WIP limit`
                }
              >
                {overLimit && <span className="sr-only">Over WIP limit: </span>}
                {tasks.length}
                {column.wipLimit !== null && `/${column.wipLimit}`}
              </span>
            )}
            {canEdit && (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="sm"
                      className="size-7 p-0 text-muted-foreground"
                      aria-label={`Column options for ${column.title}`}
                    >
                      <MoreHorizontal />
                    </Button>
                  }
                />
                <DropdownMenuContent align="end">
                  <DropdownMenuGroup>
                    <DropdownMenuItem
                      onClick={() => {
                        setDraft(column.title);
                        setRenaming(true);
                      }}
                    >
                      <Pencil /> Rename
                    </DropdownMenuItem>
                    {/* Buttons rather than dragging the columns themselves. The
                        board's DndContext is tuned for cards, and threading a
                        second, horizontal sortable through it would put M0's
                        working drag-and-drop at risk for a rarer action. These
                        are also keyboard-reachable, which a drag is not. */}
                    {/* Member-gated like rename: a limit is process tuning,
                        not destruction. The editor swaps into the header the
                        way renaming does. */}
                    <DropdownMenuItem
                      onClick={() => {
                        setLimitDraft(
                          column.wipLimit === null ? "" : String(column.wipLimit)
                        );
                        setLimiting(true);
                      }}
                    >
                      <Gauge />
                      {column.wipLimit === null
                        ? "Set WIP limit"
                        : "Change WIP limit"}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={isFirst}
                      onClick={() => onMove(-1)}
                    >
                      <ArrowLeft /> Move left
                    </DropdownMenuItem>
                    <DropdownMenuItem disabled={isLast} onClick={() => onMove(1)}>
                      <ArrowRight /> Move right
                    </DropdownMenuItem>
                    {canDelete && (
                      <>
                        <DropdownMenuSeparator />
                        {/* Which column means done is a board-shape decision, so
                            it sits with the admin-gated actions (§7.4). Toggling:
                            marking the current done column again clears it. */}
                        <DropdownMenuItem onClick={onToggleDone}>
                          <CircleCheck />
                          {isDone ? "Unset done column" : "Set as done column"}
                        </DropdownMenuItem>
                        <DropdownMenuItem variant="destructive" onClick={onDelete}>
                          <Trash2 /> Delete column
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </>
        )}
      </header>
      <SortableContext
        items={tasks.map((task) => `task-${task.id}`)}
        strategy={verticalListSortingStrategy}
      >
        <div
          ref={setNodeRef}
          className={cn(
            "flex min-h-16 flex-1 flex-col gap-2 rounded-lg px-2 pb-1",
            isOver && "bg-accent/50"
          )}
        >
          {tasks.map((task) => (
            <SortableTaskCard
              key={task.id}
              task={task}
              membersById={membersById}
              agentsById={agentsById}
              labelsById={labelsById}
              onEdit={canEdit ? onEditTask : undefined}
              onDelete={canEdit ? onDeleteTask : undefined}
            />
          ))}
        </div>
      </SortableContext>
      {canEdit && (
        <Button
          variant="ghost"
          size="sm"
          className="mx-2 mb-2 justify-start text-muted-foreground"
          onClick={onAddTask}
        >
          <Plus /> Add task
        </Button>
      )}
    </section>
  );
}
