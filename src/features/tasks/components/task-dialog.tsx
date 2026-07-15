"use client";

import { useEffect, useState } from "react";

import { ActivityFeed } from "@/features/activity/components/activity-feed";
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
}

interface TaskDialogProps {
  open: boolean;
  /** When set, the dialog edits this task; otherwise it creates a new one. */
  task?: Task;
  /** Column titles by id, so history can name the columns a task moved between. */
  columnNames: Record<number, string>;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: TaskFormValues) => Promise<void> | void;
}

export function TaskDialog({
  open,
  task,
  columnNames,
  onOpenChange,
  onSubmit,
}: TaskDialogProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setTitle(task?.title ?? "");
      setDescription(task?.description ?? "");
    }
  }, [open, task]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    try {
      await onSubmit({ title: title.trim(), description });
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
          {/* Only an existing task has history, and only while the dialog is
              open — mounting the feed otherwise would fetch on every board
              render. The key remounts it per task so switching cards cannot
              show the previous task's entries while the new ones load. */}
          {task && open && (
            <div className="grid gap-2 border-t pt-3">
              <p className="text-xs font-medium text-muted-foreground">
                History
              </p>
              <ActivityFeed
                key={task.id}
                taskId={task.id}
                columnNames={columnNames}
              />
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
