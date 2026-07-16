"use client";

import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";

import type { Member } from "@/features/workspaces/types";
import { Avatar, AvatarFallback, AvatarImage } from "@/shared/ui/avatar";
import { Button } from "@/shared/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/shared/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { formatDueDate, useToday } from "@/shared/lib/due-date";
import { PRIORITY_LABELS } from "../types";
import type { Task, TaskPriority } from "../types";

interface TaskCardProps {
  task: Task;
  /** Members by user id — the card holds an assignee id, not a name. */
  membersById: Record<string, Member>;
  onEdit?: (task: Task) => void;
  onDelete?: (task: Task) => void;
}

/**
 * A dot, not a word. At a glance a card should say *that* it is urgent, not
 * spend a line of its width saying so — the label is in the tooltip and the
 * dialog. 'none' renders nothing at all rather than a grey dot, because "not
 * triaged" is the default state of most cards and a board of grey dots says
 * nothing while costing every card the space.
 */
const PRIORITY_DOTS: Record<Exclude<TaskPriority, "none">, string> = {
  low: "bg-muted-foreground/40",
  medium: "bg-sky-500",
  high: "bg-amber-500",
  urgent: "bg-destructive",
};

function PriorityDot({ priority }: { priority: TaskPriority }) {
  if (priority === "none") return null;
  return (
    <span
      className={`size-1.5 shrink-0 rounded-full ${PRIORITY_DOTS[priority]}`}
      // Colour alone cannot carry this — it is the entire signal, and roughly a
      // twentieth of readers cannot separate the amber from the red. The label
      // is the actual content; the dot is its rendering.
      role="img"
      aria-label={`Priority: ${PRIORITY_LABELS[priority]}`}
      title={PRIORITY_LABELS[priority]}
    />
  );
}

/**
 * Its own component so useToday's effect runs only for cards that have a date —
 * a hook cannot be called conditionally, but a component can be mounted one.
 * Most cards have no due date, and this keeps them from paying for the question.
 */
function DueDate({ date }: { date: string }) {
  const today = useToday();
  // Null until mounted, so this is false during SSR and the first client render
  // — see useToday. Lexicographic comparison is chronological for this format.
  const overdue = today != null && date < today;
  return (
    <time
      dateTime={date}
      className={`shrink-0 text-xs tabular-nums ${
        overdue ? "font-medium text-destructive" : "text-muted-foreground"
      }`}
      title={overdue ? `Overdue — was due ${formatDueDate(date)}` : undefined}
    >
      {/* The word carries the state for anyone who cannot see the colour, and
          reads naturally for everyone else. */}
      {overdue && <span className="sr-only">Overdue: </span>}
      {formatDueDate(date)}
    </time>
  );
}

export function TaskCard({
  task,
  membersById,
  onEdit,
  onDelete,
}: TaskCardProps) {
  // Undefined rather than absent when the id names someone no longer in the
  // workspace. That should not outlast a round trip — removing a member clears
  // their assignments — but this render sits between the removal and the
  // refetch, so it cannot assume the lookup succeeds.
  const assignee = task.assigneeId ? membersById[task.assigneeId] : undefined;
  return (
    <Card className="cursor-grab gap-1 py-3 active:cursor-grabbing">
      <CardHeader className="px-3">
        <CardTitle className="flex items-center gap-1.5 text-sm leading-snug">
          <PriorityDot priority={task.priority} />
          {task.title}
        </CardTitle>
        {(onEdit || onDelete) && (
          <CardAction>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6 text-muted-foreground"
                    aria-label="Task actions"
                  >
                    <MoreHorizontal />
                  </Button>
                }
              />
              <DropdownMenuContent align="end">
                {onEdit && (
                  <DropdownMenuItem onClick={() => onEdit(task)}>
                    <Pencil /> Edit
                  </DropdownMenuItem>
                )}
                {onDelete && (
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => onDelete(task)}
                  >
                    <Trash2 /> Delete
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </CardAction>
        )}
      </CardHeader>
      {(task.description || assignee || task.dueDate) && (
        <CardContent className="flex items-end justify-between gap-2 px-3">
          <p className="line-clamp-3 text-xs text-muted-foreground">
            {task.description}
          </p>
          {/* The two facts a card is scanned for after its title — when it is
              due and whose it is — kept together on the trailing edge so a
              column of cards lines them up. */}
          <div className="flex shrink-0 items-center gap-2">
            {task.dueDate && <DueDate date={task.dueDate} />}
            {assignee && (
              <span title={`Assigned to ${assignee.name}`}>
                {/* The image is decorative (alt="") and the initials are hidden,
                    because both say the same thing as the text beside them. A
                    screen reader should hear "Assigned to Bob" once, not the
                    name, then "BO", then the name again. */}
                <Avatar className="size-5" aria-hidden="true">
                  <AvatarImage src={assignee.image ?? undefined} alt="" />
                  <AvatarFallback className="text-[9px]">
                    {assignee.name.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span className="sr-only">Assigned to {assignee.name}</span>
              </span>
            )}
          </div>
        </CardContent>
      )}
    </Card>
  );
}
