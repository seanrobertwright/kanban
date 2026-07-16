"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft } from "lucide-react";

import { ActivityFeed } from "@/features/activity/components/activity-feed";
import type { Actor } from "@/features/activity/types";
import type { AgentSummary } from "@/features/agents/types";
import { CommentThread } from "@/features/comments/components/comment-thread";
import { SubtaskList } from "./subtask-list";
import { LabelPicker } from "@/features/labels/components/label-picker";
import type { Label as LabelData } from "@/features/labels/types";
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
  /**
   * A person or an agent (011), or null to unassign. The picker always has a
   * value, so this is never absent — it is the one-field wedge, an Actor the
   * select encodes as "human:id" / "agent:id" and decodes on submit.
   */
  assignee: Actor | null;
  /** Never null: 'none' is how the form says "no priority". */
  priority: TaskPriority;
  /** null clears the date. The input always has a value, so never absent. */
  dueDate: string | null;
  /** Ids, not refs — the form picks from a vocabulary the server already knows. */
  labelIds: number[];
}

/** The <option> value standing in for "nobody", since a DOM value is a string. */
const UNASSIGNED = "";

/**
 * A DOM <option> value is a string, but an assignee is an Actor — a person or an
 * agent (011) — so the kind has to travel in the value itself, "human:id" or
 * "agent:id", or the form could not tell a user from an agent that happened to
 * share an id. Split on the first colon only: the type is a fixed prefix and the
 * id is whatever follows, so an id containing a colon survives the round trip.
 */
function encodeAssignee(assignee: Actor | null): string {
  return assignee ? `${assignee.type}:${assignee.id}` : UNASSIGNED;
}

function decodeAssignee(value: string): Actor | null {
  if (value === UNASSIGNED) return null;
  const colon = value.indexOf(":");
  return {
    type: value.slice(0, colon) as Actor["type"],
    id: value.slice(colon + 1),
  };
}

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
  /**
   * The board's columns, in order. Two jobs, both about subtasks: the first
   * column is where a new piece starts, and the full list is the options for a
   * piece's Status control — which exists because a subtask never reaches the
   * board and so cannot be dragged between columns the way a task is.
   */
  columns?: readonly { id: number; title: string }[];
  /**
   * The parent, when this dialog is editing one of its subtasks. A piece is
   * reached only from its parent, so this is set iff `task.parentId != null`, and
   * it is what the "back" affordance names and returns to.
   */
  parentTask?: Task;
  /** Everyone assignable here — the picker's options, and the feed's names. */
  members: Member[];
  /** The workspace's agents (011) — the picker's second group, and the feed's
   * source for an agent assignee's name. */
  agents: AgentSummary[];
  /** The workspace's vocabulary — the only labels this task may wear. */
  labels: LabelData[];
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: TaskFormValues) => Promise<void> | void;
  /** Open one of this task's pieces in this same dialog (a piece is a task). */
  onOpenSubtask?: (task: Task) => void;
  /** Return from a piece to its parent without closing the dialog. */
  onBack?: () => void;
  /**
   * Move a piece to another column. Fired the moment the Status control changes,
   * not on save: a move is its own mutation with its own log row, committed when
   * it is made — exactly as dragging a card commits one on drop, with no "save"
   * step. The content fields still persist on submit; only status is immediate,
   * because only status is a move.
   */
  onMoveSubtask?: (id: number, columnId: number) => void;
  /** After a piece is added or removed — the parent card's count is now stale. */
  onSubtasksChanged?: () => void;
}

export function TaskDialog({
  open,
  task,
  columnNames,
  columns = [],
  parentTask,
  members,
  agents,
  labels,
  onOpenChange,
  onSubmit,
  onOpenSubtask,
  onBack,
  onMoveSubtask,
  onSubtasksChanged,
}: TaskDialogProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  // The encoded picker value: "" | "human:id" | "agent:id". Decoded to an Actor
  // on submit; encoded from the task's Actor on open.
  const [assignee, setAssignee] = useState<string>(UNASSIGNED);
  const [priority, setPriority] = useState<TaskPriority>("none");
  const [dueDate, setDueDate] = useState<string>(NO_DUE_DATE);
  const [labelIds, setLabelIds] = useState<number[]>([]);
  // A piece has a status but no board to be dragged on, so its column is edited
  // here. Only meaningful when editing a subtask; the control is hidden for
  // top-level tasks, which move by drag.
  const [columnId, setColumnId] = useState<number>(0);
  const [saving, setSaving] = useState(false);

  // A subtask is any task with a parent. It is edited exactly like a task, minus
  // one thing it cannot have (subtasks of its own, depth being 1) and plus one it
  // needs a control for (its status).
  const isSubtask = task?.parentId != null;
  // Bumped by the thread whenever it writes, which makes the feed refetch. Every
  // comment mutation logs a row, so without this the history sitting directly
  // below the comment you just posted would deny it happened.
  const [activityVersion, setActivityVersion] = useState(0);

  const memberNames = useMemo(
    () => Object.fromEntries(members.map((m) => [m.userId, m.name])),
    [members]
  );
  const agentNames = useMemo(
    () => Object.fromEntries(agents.map((a) => [a.id, a.name])),
    [agents]
  );

  useEffect(() => {
    if (open) {
      setTitle(task?.title ?? "");
      setDescription(task?.description ?? "");
      setAssignee(encodeAssignee(task?.assignee ?? null));
      setPriority(task?.priority ?? "none");
      setDueDate(task?.dueDate ?? NO_DUE_DATE);
      // Back to ids: the task carries {id, name} because the log needs the name
      // (LabelRef), but the form's business is which labels, not what they are
      // called.
      setLabelIds(task?.labels.map((l) => l.id) ?? []);
      setColumnId(task?.columnId ?? 0);
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
        // Decoded back to an Actor (or null) at the boundary: the "type:id"
        // string is a DOM artifact, and the API speaks {type, id}.
        assignee: decodeAssignee(assignee),
        // No conversion: 'none' is a real priority all the way down, which is
        // the whole reason this field avoids the null-vs-absent problem the two
        // fields either side of it have.
        priority,
        // Converted for assigneeId's reason: "" is what an emptied date input
        // reports, and the API would read it as a malformed date rather than as
        // the clear it is.
        dueDate: dueDate === NO_DUE_DATE ? null : dueDate,
        // No conversion, like priority: [] is the empty set all the way down,
        // which is what keeps this field out of the null-vs-absent problem.
        labelIds,
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
            {/* Only a subtask has a parent to go back to. The button carries the
                parent's title so the reader knows what they are a piece of, and
                returns without closing — the dialog stays open, the task inside
                it changes. */}
            {parentTask && (
              <button
                type="button"
                onClick={onBack}
                className="-mt-1 mb-1 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <ChevronLeft className="size-3.5 shrink-0" />
                <span className="truncate">{parentTask.title}</span>
              </button>
            )}
            <DialogTitle>
              {task ? (isSubtask ? "Edit subtask" : "Edit task") : "New task"}
            </DialogTitle>
            <DialogDescription>
              {task
                ? isSubtask
                  ? "Update the subtask details below."
                  : "Update the task details below."
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
              the platform picker on touch. The second group is 011's agents —
              the whole wedge, and why the field was labelled "Assignee" rather
              than anything person-shaped from the start. Each group renders only
              when it has members, so a workspace with no agents shows exactly the
              picker it did before. */}
          <div className="grid gap-2">
            <Label htmlFor="task-assignee">Assignee</Label>
            <select
              id="task-assignee"
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
              className="h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30"
            >
              <option value={UNASSIGNED}>Unassigned</option>
              {members.length > 0 && (
                <optgroup label="People">
                  {members.map((member) => (
                    <option key={member.userId} value={`human:${member.userId}`}>
                      {member.name}
                    </option>
                  ))}
                </optgroup>
              )}
              {agents.length > 0 && (
                <optgroup label="Agents">
                  {agents.map((agent) => (
                    <option key={agent.id} value={`agent:${agent.id}`}>
                      {agent.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>
          {/* Status, for a piece only. A top-level task's column is its place on
              the board and it moves there by drag; a piece has no place on the
              board (008), so this is the one place its status can be set. The
              change commits immediately — see onMoveSubtask — because a move is a
              move whether it happens by drag or by this select. */}
          {isSubtask && columns.length > 0 && (
            <div className="grid gap-2">
              <Label htmlFor="task-status">Status</Label>
              <select
                id="task-status"
                value={columnId}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  setColumnId(next);
                  if (task) onMoveSubtask?.(task.id, next);
                }}
                className="h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30"
              >
                {columns.map((column) => (
                  <option key={column.id} value={column.id}>
                    {column.title}
                  </option>
                ))}
              </select>
            </div>
          )}
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
          <div className="grid gap-2">
            <Label>Labels</Label>
            <LabelPicker
              labels={labels}
              selected={labelIds}
              onChange={setLabelIds}
            />
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
              {/* A piece has no pieces of its own — depth is 1 (008) — so the
                  section is here for a top-level task only. It is the sole way to
                  reach a subtask, since none of them are on the board. */}
              {!isSubtask && (
                <SubtaskList
                  key={`subtasks-${task.id}`}
                  parentId={task.id}
                  defaultColumnId={columns[0]?.id ?? null}
                  columnNames={columnNames}
                  onOpenSubtask={(sub) => onOpenSubtask?.(sub)}
                  onChanged={onSubtasksChanged}
                />
              )}
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
                  agentNames={agentNames}
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
