"use client";

import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { Plus } from "lucide-react";

import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";
import type { Task } from "@/features/tasks/types";
import type { Member } from "@/features/workspaces/types";
import type { Column } from "../types";
import { SortableTaskCard } from "./sortable-task-card";

interface BoardColumnProps {
  column: Column;
  tasks: Task[];
  membersById: Record<string, Member>;
  canEdit: boolean;
  onAddTask: () => void;
  onEditTask: (task: Task) => void;
  onDeleteTask: (task: Task) => void;
}

export function BoardColumn({
  column,
  tasks,
  membersById,
  canEdit,
  onAddTask,
  onEditTask,
  onDeleteTask,
}: BoardColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: `col-${column.id}` });

  return (
    <section className="flex w-72 shrink-0 flex-col rounded-xl border bg-muted/50">
      <header className="flex items-center justify-between px-3 py-2.5">
        <h2 className="text-sm font-semibold">{column.title}</h2>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground">
          {tasks.length}
        </span>
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
