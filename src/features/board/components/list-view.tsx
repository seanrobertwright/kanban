"use client";

import { Bot, ListTree } from "lucide-react";

import type { AgentSummary } from "@/features/agents/types";
import { LabelChip } from "@/features/labels/components/label-chip";
import type { Label as LabelData } from "@/features/labels/types";
import {
  PriorityDot,
  resolveAssignee,
} from "@/features/tasks/components/task-card";
import { PRIORITY_LABELS, type Task } from "@/features/tasks/types";
import type { Member } from "@/features/workspaces/types";
import { formatDueDate, useToday } from "@/shared/lib/due-date";
import { Avatar, AvatarFallback, AvatarImage } from "@/shared/ui/avatar";
import type { Column } from "../types";

export interface BoardViewProps {
  columns: Column[];
  itemsByColumn: Record<number, Task[]>;
  membersById: Record<string, Member>;
  agentsById: Record<string, AgentSummary>;
  labelsById: Record<number, LabelData>;
  onEditTask: (task: Task) => void;
}

/**
 * The board's rows as a table. Same tasks the board renders (it is handed the
 * already-filtered `itemsByColumn`), read top-to-bottom in board order — each
 * task carries its column as a "Status" cell instead of living under a heading,
 * so the whole board sorts and scans as one list. A row opens the same dialog a
 * card does; there is no drag here, status changes happen in the dialog or on
 * the board.
 */
export function ListView({
  columns,
  itemsByColumn,
  membersById,
  agentsById,
  labelsById,
  onEditTask,
}: BoardViewProps) {
  const today = useToday();
  const rows = columns.flatMap((column) =>
    (itemsByColumn[column.id] ?? []).map((task) => ({ task, column }))
  );

  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        No tasks to show.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th className="px-3 py-2 font-medium">Task</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium">Assignee</th>
            <th className="px-3 py-2 font-medium">Priority</th>
            <th className="px-3 py-2 font-medium">Due</th>
            <th className="px-3 py-2 font-medium">Labels</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ task, column }) => {
            const assignee = resolveAssignee(
              task.assignee,
              membersById,
              agentsById
            );
            const overdue =
              task.dueDate != null && today != null && task.dueDate < today;
            return (
              <tr
                key={task.id}
                tabIndex={0}
                role="button"
                onClick={() => onEditTask(task)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onEditTask(task);
                  }
                }}
                className="cursor-pointer border-b last:border-0 outline-none hover:bg-muted/50 focus-visible:bg-muted/50"
              >
                <td className="px-3 py-2">
                  <span className="flex items-center gap-1.5">
                    <PriorityDot priority={task.priority} />
                    <span className="font-medium">{task.title}</span>
                    {task.subtaskCount > 0 && (
                      <span
                        className="flex items-center gap-0.5 text-xs tabular-nums text-muted-foreground"
                        title={`${task.subtaskCount} subtask${task.subtaskCount === 1 ? "" : "s"}`}
                      >
                        <ListTree className="size-3.5" aria-hidden="true" />
                        {task.subtaskCount}
                      </span>
                    )}
                  </span>
                </td>
                <td className="px-3 py-2 text-muted-foreground">
                  {column.title}
                </td>
                <td className="px-3 py-2">
                  {assignee ? (
                    <span className="flex items-center gap-1.5">
                      {assignee.isAgent && (
                        <Bot
                          className="size-3.5 text-muted-foreground"
                          aria-hidden="true"
                        />
                      )}
                      <Avatar className="size-5" aria-hidden="true">
                        <AvatarImage src={assignee.image ?? undefined} alt="" />
                        <AvatarFallback className="text-[9px]">
                          {assignee.name.slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <span className="truncate">{assignee.name}</span>
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-3 py-2 text-muted-foreground">
                  {task.priority === "none" ? "—" : PRIORITY_LABELS[task.priority]}
                </td>
                <td className="px-3 py-2">
                  {task.dueDate ? (
                    <time
                      dateTime={task.dueDate}
                      className={`tabular-nums ${overdue ? "font-medium text-destructive" : "text-muted-foreground"}`}
                    >
                      {overdue && <span className="sr-only">Overdue: </span>}
                      {formatDueDate(task.dueDate)}
                    </time>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {task.labels.length > 0 ? (
                    <span className="flex flex-wrap gap-1">
                      {task.labels.map((label) => (
                        <LabelChip
                          key={label.id}
                          name={label.name}
                          color={labelsById[label.id]?.color}
                        />
                      ))}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
