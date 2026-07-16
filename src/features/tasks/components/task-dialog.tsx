"use client";

import { useEffect, useMemo, useState } from "react";

import { ActivityFeed } from "@/features/activity/components/activity-feed";
import { CommentThread } from "@/features/comments/components/comment-thread";
import type { Member } from "@/features/workspaces/types";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Textarea } from "@/shared/ui/textarea";
import type { Task } from "../types";

export interface TaskFormValues {
  title: string;
  description: string;
  /** null unassigns. The picker always has a value, so this is never absent. */
  assigneeId: string | null;
}

/** The <option> value standing in for "nobody", since a DOM value is a string. */
const UNASSIGNED = "";

interface TaskDialogProps {
  open: boolean;
  /** When set, the dialog edits this task; otherwise it creates a new one. */
  task?: Task;
  /** Column titles by id, so history can name the columns a task moved between. */
  columnNames: Record<number, string>;
  /** Everyone assignable here — the picker's options, and the feed's names. */
  members: Member[];
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: TaskFormValues) => Promise<void> | void;
}

export function TaskDialog({
  open,
  task,
  columnNames,
  members,
  onOpenChange,
  onSubmit,
}: TaskDialogProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assigneeId, setAssigneeId] = useState<string>(UNASSIGNED);
  const [saving, setSaving] = useState(false);
  // Bumped by the thread whenever it writes, which makes the feed refetch. Every
  // comment mutation logs a row, so without this the history sitting directly
  // below the comment you just posted would deny it happened.
  const [activityVersion, setActivityVersion] = useState(0);

  const memberNames = useMemo(
    () => Object.fromEntries(members.map((m) => [m.userId, m.name])),
    [members]
  );

  useEffect(() => {
    if (open) {
      setTitle(task?.title ?? "");
      setDescription(task?.description ?? "");
      setAssigneeId(task?.assigneeId ?? UNASSIGNED);
    }
  }, [open, task]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    try {
      await onSubmit({
        title: title.trim(),
        description,
        // Back to null at the boundary: the empty string is a DOM artifact, and
        // letting it reach the API would try to assign a user whose id is "".
        assigneeId: assigneeId === UNASSIGNED ? null : assigneeId,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{task ? "Edit task" : "New task"}</DialogTitle>
            <DialogDescription>
              {task
                ? "Update the task details below."
                : "Add a task to this column."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="task-title">Title</Label>
            <Input
              id="task-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What needs doing?"
              autoFocus
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="task-description">Description</Label>
            <Textarea
              id="task-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional details"
              rows={4}
            />
          </div>
          {/* A native select rather than a styled menu: it is one tab stop, it
              is announced as a listbox without any ARIA of our own, and it gets
              the platform picker on touch. At M2 this list grows a second group
              of agents — which is the whole wedge, and is why the field is
              labelled "Assignee" rather than anything person-shaped. */}
          <div className="grid gap-2">
            <Label htmlFor="task-assignee">Assignee</Label>
            <select
              id="task-assignee"
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
              className="h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30"
            >
              <option value={UNASSIGNED}>Unassigned</option>
              {members.map((member) => (
                <option key={member.userId} value={member.userId}>
                  {member.name}
                </option>
              ))}
            </select>
          </div>
          {/* Only an existing task has a thread or history, and only while the
              dialog is open — mounting either otherwise would fetch on every
              board render. The keys remount them per task so switching cards
              cannot show the previous task's entries while the new ones load.

              Comments come first because they are the conversation and the
              history is the receipt: the thread is what a reader came for, and
              at M2 it is where an agent reports what it did. */}
          {task && open && (
            <div className="grid gap-4 border-t pt-3">
              <CommentThread
                key={`comments-${task.id}`}
                taskId={task.id}
                onChanged={() => setActivityVersion((v) => v + 1)}
              />
              <div className="grid gap-2">
                <p className="text-xs font-medium text-muted-foreground">
                  History
                </p>
                <ActivityFeed
                  key={task.id}
                  taskId={task.id}
                  columnNames={columnNames}
                  memberNames={memberNames}
                  refreshToken={activityVersion}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !title.trim()}>
              {task ? "Save changes" : "Create task"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
