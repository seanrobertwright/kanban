"use client";

import { ListTree, Lock, MoreHorizontal, Pencil, Trash2 } from "lucide-react";

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
import { LabelChip } from "@/features/labels/components/label-chip";
import type { Label as LabelData } from "@/features/labels/types";
import { formatDueDate, useToday } from "@/shared/lib/due-date";
import { PRIORITY_LABELS } from "../types";
import type { Task, TaskPriority } from "../types";

interface TaskCardProps {
  task: Task;
  /** Members by user id — the card holds an assignee id, not a name. */
  membersById: Record<string, Member>;
  /**
   * Labels by id, for their colour only — the task carries its own names
   * (LabelRef), because the log needs them. A colour is presentation, so it is
   * looked up against the vocabulary the picker already holds rather than copied
   * onto every task that wears the label.
   */
  labelsById?: Record<number, LabelData>;
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

/**
 * Exported because the subtask list renders the same dot — a piece is a whole
 * task and its priority reads the same way there as on a card. One dot, one set
 * of colours, one accessibility argument, rather than a second copy to drift.
 */
export function PriorityDot({ priority }: { priority: TaskPriority }) {
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
  labelsById = {},
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
      {task.labels.length > 0 && (
        <CardContent className="flex flex-wrap gap-1 px-3">
          {task.labels.map((label) => (
            // The name comes from the task, the colour from the vocabulary — and
            // the lookup is allowed to miss, for the moment between someone
            // deleting a label and this board refetching. LabelChip falls back to
            // slate rather than crashing, which keeps the name on screen.
            <LabelChip
              key={label.id}
              name={label.name}
              color={labelsById[label.id]?.color}
            />
          ))}
        </CardContent>
      )}
      {(task.description ||
        assignee ||
        task.dueDate ||
        task.subtaskCount > 0 ||
        task.claimedBy) && (
        <CardContent className="flex items-end justify-between gap-2 px-3">
          <p className="line-clamp-3 text-xs text-muted-foreground">
            {task.description}
          </p>
          {/* The facts a card is scanned for after its title — how many pieces
              it has, when it is due, and whose it is — kept together on the
              trailing edge so a column of cards lines them up. */}
          <div className="flex shrink-0 items-center gap-2">
            {/* A held task is one someone — often an agent — is actively working,
                which is the wedge made visible on a card. The lock is the sign;
                the word carries it for anyone who cannot see the icon. The
                holder's name is not resolved here: only humans are in a
                client-side roster today, so an agent's hold reads generically
                until an agent list lands with the rest of M2. */}
            {task.claimedBy && (
              <span
                title={
                  task.claimedBy.type === "agent"
                    ? "An agent is working on this"
                    : "Being worked on"
                }
              >
                <Lock
                  className="size-3.5 text-muted-foreground"
                  aria-hidden="true"
                />
                <span className="sr-only">
                  {task.claimedBy.type === "agent"
                    ? "An agent is working on this"
                    : "Being worked on"}
                </span>
              </span>
            )}
            {/* The count only, never a "2 of 5 done": completion would need a
                second query per card (how many pieces sit in a done column, and
                which columns are "done" is user-defined and unknowable here).
                The number says there is work inside; the dialog says what. */}
            {task.subtaskCount > 0 && (
              <span
                className="flex items-center gap-0.5 text-xs tabular-nums text-muted-foreground"
                title={`${task.subtaskCount} subtask${
                  task.subtaskCount === 1 ? "" : "s"
                }`}
              >
                <ListTree className="size-3.5" aria-hidden="true" />
                <span className="sr-only">Subtasks: </span>
                {task.subtaskCount}
              </span>
            )}
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
