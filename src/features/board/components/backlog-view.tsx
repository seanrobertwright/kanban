"use client";

import { useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { Inbox, Rocket } from "lucide-react";

import type { AgentSummary } from "@/features/agents/types";
import type { Label as LabelData } from "@/features/labels/types";
import { TaskCard } from "@/features/tasks/components/task-card";
import { PRIORITY_ORDER, type Task } from "@/features/tasks/types";
import { SPRINT_STATUS_LABELS, type Sprint } from "@/features/sprints/types";
import type { Member } from "@/features/workspaces/types";
import { cn } from "@/shared/lib/utils";
import { SortableTaskCard } from "./sortable-task-card";

/**
 * The backlog as its own surface (028/M4) — the sprint_id IS NULL queue beside
 * the board's upcoming sprints, so planning is a drag rather than a per-task
 * dialog trip. Distinct from the board lens on purpose: a column is a *workflow
 * state* (todo → doing → done), a bucket here is a *commitment* (which sprint,
 * or none). The two are orthogonal — dragging a card into a sprint sets its
 * sprint_id and leaves its column untouched.
 *
 * Only planning and active sprints are drop targets: a completed sprint's scope
 * is frozen (the server refuses scheduling into one), and its only remaining
 * tasks are the done ones, which are not backlog to plan. So a completed
 * sprint's tasks simply do not appear here — they live on the board under their
 * columns, where finished work belongs.
 */

interface Bucket {
  /** The droppable id: "backlog" or "sprint-<id>". */
  key: string;
  /** null is the backlog; a number is that sprint. */
  sprintId: number | null;
  title: string;
  subtitle: string | null;
  tasks: Task[];
}

interface BacklogViewProps {
  /** Top-level tasks, already filtered — the same list the other lenses see. */
  tasks: Task[];
  sprints: Sprint[];
  membersById: Record<string, Member>;
  agentsById: Record<string, AgentSummary>;
  labelsById: Record<number, LabelData>;
  canEdit: boolean;
  onEditTask: (task: Task) => void;
  /** Schedule a task into a sprint, or null to send it back to the backlog. */
  onAssignSprint: (task: Task, sprintId: number | null) => void;
}

/** Highest priority first, then oldest — the order a backlog is groomed in. */
function backlogOrder(a: Task, b: Task): number {
  const byPriority =
    PRIORITY_ORDER.indexOf(b.priority) - PRIORITY_ORDER.indexOf(a.priority);
  return byPriority !== 0 ? byPriority : a.id - b.id;
}

function BacklogColumn({
  bucket,
  membersById,
  agentsById,
  labelsById,
  canEdit,
  onEditTask,
}: {
  bucket: Bucket;
  membersById: Record<string, Member>;
  agentsById: Record<string, AgentSummary>;
  labelsById: Record<number, LabelData>;
  canEdit: boolean;
  onEditTask: (task: Task) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: bucket.key });
  const points = bucket.tasks.reduce((sum, t) => sum + (t.estimate ?? 0), 0);
  const isBacklog = bucket.sprintId === null;

  return (
    <div className="w-72 shrink-0">
      <div className="mb-2 flex items-center justify-between px-1">
        <div className="flex items-center gap-1.5 text-sm font-medium">
          {isBacklog ? (
            <Inbox className="size-4 text-muted-foreground" />
          ) : (
            <Rocket className="size-4 text-muted-foreground" />
          )}
          <span className="truncate">{bucket.title}</span>
          {bucket.subtitle && (
            <span className="text-xs font-normal text-muted-foreground">
              {bucket.subtitle}
            </span>
          )}
        </div>
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {bucket.tasks.length} · {points} pts
        </span>
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          "grid min-h-24 content-start gap-2 rounded-xl border p-2 transition-colors",
          isBacklog ? "bg-muted/30" : "bg-muted/50",
          isOver && "border-primary bg-primary/5"
        )}
      >
        <SortableContext
          items={bucket.tasks.map((t) => `task-${t.id}`)}
          strategy={verticalListSortingStrategy}
        >
          {bucket.tasks.length === 0 ? (
            <p className="px-1 py-6 text-center text-xs text-muted-foreground">
              {isBacklog ? "Nothing unscheduled." : "Drag work here to plan it in."}
            </p>
          ) : (
            bucket.tasks.map((task) => (
              <SortableTaskCard
                key={task.id}
                task={task}
                membersById={membersById}
                agentsById={agentsById}
                labelsById={labelsById}
                onEdit={canEdit ? onEditTask : undefined}
              />
            ))
          )}
        </SortableContext>
      </div>
    </div>
  );
}

export function BacklogView({
  tasks,
  sprints,
  membersById,
  agentsById,
  labelsById,
  canEdit,
  onEditTask,
  onAssignSprint,
}: BacklogViewProps) {
  const [activeTask, setActiveTask] = useState<Task | null>(null);

  const buckets = useMemo<Bucket[]>(() => {
    const plannable = sprints.filter((s) => s.status !== "completed");
    const inBucket = (sprintId: number | null) =>
      tasks.filter((t) => t.sprintId === sprintId).sort(backlogOrder);
    return [
      {
        key: "backlog",
        sprintId: null,
        title: "Backlog",
        subtitle: null,
        tasks: inBucket(null),
      },
      ...plannable.map((sprint) => ({
        key: `sprint-${sprint.id}`,
        sprintId: sprint.id,
        title: sprint.name,
        subtitle: SPRINT_STATUS_LABELS[sprint.status],
        tasks: inBucket(sprint.id),
      })),
    ];
  }, [tasks, sprints]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  function handleDragStart(event: DragStartEvent) {
    const id = Number(String(event.active.id).slice(5));
    setActiveTask(tasks.find((t) => t.id === id) ?? null);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveTask(null);
    const { active, over } = event;
    if (!over) return;
    const task = tasks.find((t) => `task-${t.id}` === String(active.id));
    if (!task) return;

    // The drop target is a column (its droppable id) or another card (whose
    // bucket we read off the card). undefined means "resolve to nothing" — a
    // stray drop that changes no assignment.
    const overId = String(over.id);
    let target: number | null | undefined;
    if (overId === "backlog") {
      target = null;
    } else if (overId.startsWith("sprint-")) {
      target = Number(overId.slice(7));
    } else if (overId.startsWith("task-")) {
      target = tasks.find((t) => `task-${t.id}` === overId)?.sprintId ?? undefined;
    }
    if (target === undefined || target === task.sprintId) return;
    onAssignSprint(task, target);
  }

  return (
    <DndContext
      id="backlog-dnd"
      sensors={canEdit ? sensors : []}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveTask(null)}
    >
      <div className="flex items-start gap-4 overflow-x-auto pb-4">
        {buckets.map((bucket) => (
          <BacklogColumn
            key={bucket.key}
            bucket={bucket}
            membersById={membersById}
            agentsById={agentsById}
            labelsById={labelsById}
            canEdit={canEdit}
            onEditTask={onEditTask}
          />
        ))}
      </div>
      <DragOverlay>
        {activeTask ? (
          <TaskCard
            task={activeTask}
            membersById={membersById}
            agentsById={agentsById}
            labelsById={labelsById}
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
