"use client";

import {
  Bot,
  Bug,
  BookOpen,
  Link2,
  ListChecks,
  ListTree,
  Lock,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Repeat,
  Trash2,
} from "lucide-react";

import type { AgentSummary } from "@/features/agents/types";
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
import { PRIORITY_LABELS, RECURRENCE_LABELS, TASK_TYPE_LABELS } from "../types";
import type { Task, TaskPriority, TaskType } from "../types";

interface TaskCardProps {
  task: Task;
  /** Members by user id — the card holds an assignee id, not a name. */
  membersById: Record<string, Member>;
  /** Agents by id (011) — the other place an assignee's name and face resolve. */
  agentsById?: Record<string, AgentSummary>;
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
 * A mark for the non-default kinds only (022): 'task' renders nothing, for
 * PRIORITY_DOTS's reason — it is the state of most cards, and a board of
 * identical marks says nothing while costing every card the space. Exported for
 * the subtask list, PriorityDot's precedent: a piece is a whole task and its
 * kind reads the same way there.
 */
export function TypeMark({ type }: { type: TaskType }) {
  if (type === "task") return null;
  const Icon = type === "bug" ? Bug : BookOpen;
  return (
    // The icon is the entire signal, so the label is the content — the same
    // accessibility argument PriorityDot makes for its dot. The span carries
    // the tooltip and the sr-only text; the icon itself is decoration.
    <span className="shrink-0" title={TASK_TYPE_LABELS[type]}>
      <Icon
        className={`size-3.5 ${
          type === "bug" ? "text-destructive" : "text-sky-500"
        }`}
        aria-hidden="true"
      />
      <span className="sr-only">Type: {TASK_TYPE_LABELS[type]}</span>
    </span>
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

/**
 * The assignee's display data, resolved from whichever roster its kind names
 * (011): a human from the members, an agent from the agents. Undefined when
 * unassigned, or when the id names someone no longer in the workspace — which
 * should not outlast a round trip (removing a member clears their assignments),
 * but this render sits between the removal and the refetch, so it cannot assume
 * the lookup succeeds. `isAgent` is what the card marks visibly: an agent holding
 * a task is the wedge on a card, the peer to a person §4.3 calls for.
 */
export function resolveAssignee(
  assignee: Task["assignee"],
  membersById: Record<string, Member>,
  agentsById: Record<string, AgentSummary>
): { name: string; image: string | null; isAgent: boolean } | undefined {
  if (!assignee) return undefined;
  if (assignee.type === "agent") {
    const agent = agentsById[assignee.id];
    return agent && { name: agent.name, image: agent.image, isAgent: true };
  }
  const member = membersById[assignee.id];
  return member && { name: member.name, image: member.image, isAgent: false };
}

export function TaskCard({
  task,
  membersById,
  agentsById = {},
  labelsById = {},
  onEdit,
  onDelete,
}: TaskCardProps) {
  const assignee = resolveAssignee(task.assignee, membersById, agentsById);
  return (
    <Card className="cursor-grab gap-1 py-3 active:cursor-grabbing">
      <CardHeader className="px-3">
        <CardTitle className="flex items-center gap-1.5 text-sm leading-snug">
          <PriorityDot priority={task.priority} />
          <TypeMark type={task.type} />
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
        task.estimate != null ||
        task.subtaskCount > 0 ||
        task.checklist.total > 0 ||
        task.blockedByCount > 0 ||
        task.attachmentCount > 0 ||
        task.recurrence ||
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
            {/* Recurs (020). The loop icon says the task will spawn a successor
                when completed; the cadence is in the tooltip and the dialog. */}
            {task.recurrence && (
              <span title={`Repeats: ${RECURRENCE_LABELS[task.recurrence]}`}>
                <Repeat
                  className="size-3.5 text-muted-foreground"
                  aria-hidden="true"
                />
                <span className="sr-only">
                  Repeats {RECURRENCE_LABELS[task.recurrence]}
                </span>
              </span>
            )}
            {/* Dependencies (018), now with a real blocked state (020's done
                column made it knowable). Two readings, and colour tells them
                apart: blockedByOpenCount > 0 means the task waits on unfinished
                work — the destructive red and the count of what is still open.
                Otherwise the blockers are all done (or there is no done column to
                judge by), so it reads as a neutral "depends on N". */}
            {task.blockedByCount > 0 &&
              (task.blockedByOpenCount > 0 ? (
                <span
                  className="flex items-center gap-0.5 text-xs tabular-nums font-medium text-destructive"
                  title={`Blocked by ${task.blockedByOpenCount} unfinished task${
                    task.blockedByOpenCount === 1 ? "" : "s"
                  }`}
                >
                  <Link2 className="size-3.5" aria-hidden="true" />
                  <span className="sr-only">Blocked by: </span>
                  {task.blockedByOpenCount}
                </span>
              ) : (
                <span
                  className="flex items-center gap-0.5 text-xs tabular-nums text-muted-foreground"
                  title={`Depends on ${task.blockedByCount} task${
                    task.blockedByCount === 1 ? "" : "s"
                  }`}
                >
                  <Link2 className="size-3.5" aria-hidden="true" />
                  <span className="sr-only">Depends on: </span>
                  {task.blockedByCount}
                </span>
              ))}
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
            {/* Attached files (021). The count only — the names and sizes are in
                the dialog. A paperclip is the near-universal sign for it. */}
            {task.attachmentCount > 0 && (
              <span
                className="flex items-center gap-0.5 text-xs tabular-nums text-muted-foreground"
                title={`${task.attachmentCount} attachment${
                  task.attachmentCount === 1 ? "" : "s"
                }`}
              >
                <Paperclip className="size-3.5" aria-hidden="true" />
                <span className="sr-only">Attachments: </span>
                {task.attachmentCount}
              </span>
            )}
            {/* Checklist progress (017): all-done reads in the accent so a
                finished list is legible at a glance, the same signal the
                strike-through gives inside the task. */}
            {task.checklist.total > 0 && (
              <span
                className={`flex items-center gap-0.5 text-xs tabular-nums ${
                  task.checklist.done === task.checklist.total
                    ? "text-primary"
                    : "text-muted-foreground"
                }`}
                title={`Checklist: ${task.checklist.done} of ${task.checklist.total} done`}
              >
                <ListChecks className="size-3.5" aria-hidden="true" />
                <span className="sr-only">Checklist: </span>
                {task.checklist.done}/{task.checklist.total}
              </span>
            )}
            {/* The estimate (022): a small bordered chip, so a column's points
                line up and can be eyeballed into a sum. null renders nothing —
                unestimated is the default state of most cards. */}
            {task.estimate != null && (
              <span
                className="rounded-full border px-1.5 text-xs tabular-nums text-muted-foreground"
                title={`Estimate: ${task.estimate} point${
                  task.estimate === 1 ? "" : "s"
                }`}
              >
                <span className="sr-only">Estimate: </span>
                {task.estimate}
              </span>
            )}
            {task.dueDate && <DueDate date={task.dueDate} />}
            {assignee && (
              // A person or an agent (011). The bot mark is the visible
              // difference — "counts human and agent capacity as peers" (§4.3),
              // shown on the card — and the word carries it for anyone who cannot
              // see the icon. The image is decorative (alt="") and the initials
              // hidden, because both say the same thing as the sr-only text: a
              // screen reader should hear "Agent Triage Bot" once, not the name,
              // then "TR", then the name again.
              <span
                className="flex items-center gap-1"
                title={`${assignee.isAgent ? "Agent" : "Assigned to"} ${assignee.name}`}
              >
                {assignee.isAgent && (
                  <Bot className="size-3.5 text-muted-foreground" aria-hidden="true" />
                )}
                <Avatar className="size-5" aria-hidden="true">
                  <AvatarImage src={assignee.image ?? undefined} alt="" />
                  <AvatarFallback className="text-[9px]">
                    {assignee.name.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span className="sr-only">
                  {assignee.isAgent ? "Agent" : "Assigned to"} {assignee.name}
                </span>
              </span>
            )}
          </div>
        </CardContent>
      )}
    </Card>
  );
}
