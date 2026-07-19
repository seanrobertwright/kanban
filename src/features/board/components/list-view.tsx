"use client";

import { useState } from "react";
import { Bot, ListTree, X } from "lucide-react";

import type { Actor } from "@/features/activity/types";
import type { AgentSummary } from "@/features/agents/types";
import { LabelChip } from "@/features/labels/components/label-chip";
import type { Label as LabelData } from "@/features/labels/types";
import * as tasksApi from "@/features/tasks/client/api";
import {
  PriorityDot,
  TypeMark,
  resolveAssignee,
} from "@/features/tasks/components/task-card";
import {
  PRIORITY_LABELS,
  PRIORITY_ORDER,
  type Task,
  type TaskPriority,
} from "@/features/tasks/types";
import type { Member } from "@/features/workspaces/types";
import { formatDueDate, useToday } from "@/shared/lib/due-date";
import { Avatar, AvatarFallback, AvatarImage } from "@/shared/ui/avatar";
import { Button } from "@/shared/ui/button";
import type { Column } from "../types";

export interface BoardViewProps {
  columns: Column[];
  itemsByColumn: Record<number, Task[]>;
  membersById: Record<string, Member>;
  agentsById: Record<string, AgentSummary>;
  labelsById: Record<number, LabelData>;
  onEditTask: (task: Task) => void;
}

interface ListViewProps extends BoardViewProps {
  /** The rosters as lists, for the bulk bar's assignee picker — the byId maps
   * above resolve names but cannot enumerate options. */
  members: Member[];
  agents: AgentSummary[];
  /** Member and up. Below it the checkboxes never render — reading is free. */
  canEdit: boolean;
  /** After a bulk write lands: the rows on screen are now stale. */
  onChanged: () => void;
}

/** The <select> placeholder — pick an action, not a value. */
const NOOP = "";

const SELECT_CLASS =
  "h-8 rounded-lg border border-input bg-transparent px-2.5 py-1 text-xs transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

/**
 * The board's rows as a table. Same tasks the board renders (it is handed the
 * already-filtered `itemsByColumn`), read top-to-bottom in board order — each
 * task carries its column as a "Status" cell instead of living under a heading,
 * so the whole board sorts and scans as one list. A row opens the same dialog a
 * card does; there is no drag here, status changes happen in the dialog or on
 * the board.
 *
 * This is also where bulk edit lives, because a table is the only surface that
 * can honestly offer "these twelve": cards are for one task at a time. Tick
 * rows, then the bar above applies one change to all of them — the server
 * loops the per-task mutations, so every task keeps its own authz check and
 * its own history rows.
 */
export function ListView({
  columns,
  itemsByColumn,
  membersById,
  agentsById,
  labelsById,
  members,
  agents,
  canEdit,
  onEditTask,
  onChanged,
}: ListViewProps) {
  const today = useToday();
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rows = columns.flatMap((column) =>
    (itemsByColumn[column.id] ?? []).map((task) => ({ task, column }))
  );
  // Selection is pruned against what is on screen at render time, so ids from
  // a previous filter cannot ride into a bulk action the user cannot see.
  const visibleIds = new Set(rows.map((r) => r.task.id));
  const picked = [...selected].filter((id) => visibleIds.has(id));

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function apply(
    action: Parameters<typeof tasksApi.bulkTasks>[1]
  ): Promise<void> {
    if (picked.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await tasksApi.bulkTasks(picked, action);
      if (result.failed.length > 0) {
        setError(
          `${result.failed.length} of ${picked.length} failed: ${result.failed[0].error}`
        );
      }
      setSelected(new Set());
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bulk edit failed");
    } finally {
      setBusy(false);
    }
  }

  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        No tasks to show.
      </p>
    );
  }

  return (
    <div className="grid gap-2">
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {/* The bulk bar exists only while something is ticked — an empty bar
          would be a row of controls that do nothing. Each select is an action
          menu, not a value: picking applies immediately and resets. */}
      {canEdit && picked.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/50 px-3 py-2 text-sm">
          <span className="tabular-nums font-medium">
            {picked.length} selected
          </span>
          <select
            aria-label="Move selected to column"
            className={SELECT_CLASS}
            value={NOOP}
            disabled={busy}
            onChange={(e) => {
              if (e.target.value !== NOOP)
                void apply({ columnId: Number(e.target.value) });
            }}
          >
            <option value={NOOP}>Move to…</option>
            {columns.map((column) => (
              <option key={column.id} value={column.id}>
                {column.title}
              </option>
            ))}
          </select>
          <select
            aria-label="Set priority for selected"
            className={SELECT_CLASS}
            value={NOOP}
            disabled={busy}
            onChange={(e) => {
              if (e.target.value !== NOOP)
                void apply({ priority: e.target.value as TaskPriority });
            }}
          >
            <option value={NOOP}>Set priority…</option>
            {[...PRIORITY_ORDER].reverse().map((value) => (
              <option key={value} value={value}>
                {PRIORITY_LABELS[value]}
              </option>
            ))}
          </select>
          <select
            aria-label="Assign selected"
            className={SELECT_CLASS}
            value={NOOP}
            disabled={busy}
            onChange={(e) => {
              const v = e.target.value;
              if (v === NOOP) return;
              // "none" unassigns; otherwise the task dialog's "type:id"
              // encoding, decoded the same way.
              const assignee: Actor | null =
                v === "none"
                  ? null
                  : {
                      type: v.slice(0, v.indexOf(":")) as Actor["type"],
                      id: v.slice(v.indexOf(":") + 1),
                    };
              void apply({ assignee });
            }}
          >
            <option value={NOOP}>Assign to…</option>
            <option value="none">Unassigned</option>
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
          <Button
            variant="destructive"
            size="sm"
            disabled={busy}
            onClick={() => void apply({ delete: true })}
          >
            Delete
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            disabled={busy}
            onClick={() => setSelected(new Set())}
          >
            <X /> Clear
          </Button>
        </div>
      )}
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              {canEdit && (
                <th className="w-8 px-3 py-2">
                  <input
                    type="checkbox"
                    aria-label="Select all tasks"
                    checked={picked.length === rows.length && rows.length > 0}
                    onChange={(e) =>
                      setSelected(
                        e.target.checked ? new Set(visibleIds) : new Set()
                      )
                    }
                  />
                </th>
              )}
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
                  {canEdit && (
                    <td
                      className="w-8 px-3 py-2"
                      // The checkbox is its own control on a row that is a
                      // button — a tick must not also open the dialog.
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        aria-label={`Select ${task.title}`}
                        checked={selected.has(task.id)}
                        onChange={() => toggle(task.id)}
                      />
                    </td>
                  )}
                  <td className="px-3 py-2">
                    <span className="flex items-center gap-1.5">
                      <PriorityDot priority={task.priority} />
                      <TypeMark type={task.type} />
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
                          <AvatarImage
                            src={assignee.image ?? undefined}
                            alt=""
                          />
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
                    {task.priority === "none"
                      ? "—"
                      : PRIORITY_LABELS[task.priority]}
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
    </div>
  );
}
