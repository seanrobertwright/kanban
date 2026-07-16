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
import { PRIORITY_LABELS, PRIORITY_ORDER } from "../types";
import type { Task, TaskPriority } from "../types";

export interface TaskFormValues {
  title: string;
  description: string;
  /** null unassigns. The picker always has a value, so this is never absent. */
  assigneeId: string | null;
  /** Never null: 'none' is how the form says "no priority". */
  priority: TaskPriority;
  /** null clears the date. The input always has a value, so never absent. */
  dueDate: string | null;
}

/** The <option> value standing in for "nobody", since a DOM value is a string. */
const UNASSIGNED = "";

/**
 * The empty <input type="date">, which reports "" when cleared. Distinct from
 * UNASSIGNED only in name — but they mean different things and are converted at
 * different boundaries, and collapsing them to one constant would be a pun.
 */
const NO_DUE_DATE = "";

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
  const [priority, setPriority] = useState<TaskPriority>("none");
  const [dueDate, setDueDate] = useState<string>(NO_DUE_DATE);
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
      setPriority(task?.priority ?? "none");
      setDueDate(task?.dueDate ?? NO_DUE_DATE);
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
        // No conversion: 'none' is a real priority all the way down, which is
        // the whole reason this field avoids the null-vs-absent problem the two
        // fields either side of it have.
        priority,
        // Converted for assigneeId's reason: "" is what an emptied date input
        // reports, and the API would read it as a malformed date rather than as
        // the clear it is.
        dueDate: dueDate === NO_DUE_DATE ? null : dueDate,
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
          {/* Side by side because they are one thought — PRD §9 calls these
              "the fields an agent reasons over when triaging", and a human
              triaging does the same: how urgent, and by when. */}
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="task-priority">Priority</Label>
              <select
                id="task-priority"
                value={priority}
                onChange={(e) => setPriority(e.target.value as TaskPriority)}
                className="h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30"
              >
                {/* Highest first: the reason to open this menu is almost always
                    to raise a priority, and 'none' is where you already are. The
                    stored order is lowest-first (it is a sort order, and DESC
                    reads better than ASC in a query) — so this reverses a copy
                    rather than reading PRIORITY_ORDER directly, which would
                    silently reorder the enum for everyone. */}
                {[...PRIORITY_ORDER].reverse().map((value) => (
                  <option key={value} value={value}>
                    {PRIORITY_LABELS[value]}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="task-due-date">Due date</Label>
              {/* type="date" is the rare case where the platform control is
                  exactly right: its value is 'YYYY-MM-DD' whatever locale it
                  displays in, so the string the API wants is the string the DOM
                  already holds — no parsing, no formatting, and no Date to
                  convert a zoneless date through. It also clears to "" on its
                  own, which is the only other state the field has. */}
              <Input
                id="task-due-date"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
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
