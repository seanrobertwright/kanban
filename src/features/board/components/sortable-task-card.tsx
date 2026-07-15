"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { TaskCard } from "@/features/tasks/components/task-card";
import type { Task } from "@/features/tasks/types";
import type { Member } from "@/features/workspaces/types";

interface SortableTaskCardProps {
  task: Task;
  membersById: Record<string, Member>;
  // Omitted for viewers, which is what hides TaskCard's action menu.
  onEdit?: (task: Task) => void;
  onDelete?: (task: Task) => void;
}

export function SortableTaskCard({
  task,
  membersById,
  onEdit,
  onDelete,
}: SortableTaskCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: `task-${task.id}` });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={isDragging ? "opacity-40" : undefined}
      {...attributes}
      {...listeners}
    >
      <TaskCard
        task={task}
        membersById={membersById}
        onEdit={onEdit}
        onDelete={onDelete}
      />
    </div>
  );
}
