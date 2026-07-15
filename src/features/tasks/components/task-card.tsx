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
import type { Task } from "../types";

interface TaskCardProps {
  task: Task;
  /** Members by user id — the card holds an assignee id, not a name. */
  membersById: Record<string, Member>;
  onEdit?: (task: Task) => void;
  onDelete?: (task: Task) => void;
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
        <CardTitle className="text-sm leading-snug">{task.title}</CardTitle>
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
      {(task.description || assignee) && (
        <CardContent className="flex items-end justify-between gap-2 px-3">
          <p className="line-clamp-3 text-xs text-muted-foreground">
            {task.description}
          </p>
          {assignee && (
            <span className="shrink-0" title={`Assigned to ${assignee.name}`}>
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
        </CardContent>
      )}
    </Card>
  );
}
