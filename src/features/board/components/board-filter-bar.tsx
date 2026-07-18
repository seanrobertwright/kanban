"use client";

import { Bot, Search, X } from "lucide-react";

import type { Actor } from "@/features/activity/types";
import { labelDotClass } from "@/features/labels/components/label-chip";
import type { Label } from "@/features/labels/types";
import type { AgentSummary } from "@/features/agents/types";
import type { Task } from "@/features/tasks/types";
import {
  PRIORITY_LABELS,
  PRIORITY_ORDER,
  type TaskPriority,
} from "@/features/tasks/types";
import type { Member } from "@/features/workspaces/types";
import { Button } from "@/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { Input } from "@/shared/ui/input";

/**
 * The board's client-side filter. Nothing here touches the server: every task is
 * already loaded, so filtering is a view over `items`, not a query. That is also
 * why it is ephemeral — it lives as long as the board is mounted and no longer.
 * Saved views (a later feature) are what make a filter outlive the session.
 *
 * Within a facet the selected values are OR'd (any chosen priority matches);
 * across facets they are AND'd (a matching priority AND a matching label). The
 * assignee facet carries the sentinel "unassigned" so "has no assignee" is a
 * value you can pick rather than an absence you cannot express.
 */
export interface BoardFilter {
  text: string;
  priorities: TaskPriority[];
  labelIds: number[];
  /** Actor keys — `human:<id>` / `agent:<id>` — plus the literal "unassigned". */
  assignees: string[];
}

export const EMPTY_FILTER: BoardFilter = {
  text: "",
  priorities: [],
  labelIds: [],
  assignees: [],
};

export function isFilterActive(f: BoardFilter): boolean {
  return (
    f.text.trim() !== "" ||
    f.priorities.length > 0 ||
    f.labelIds.length > 0 ||
    f.assignees.length > 0
  );
}

function actorKey(a: Actor | null): string {
  return a ? `${a.type}:${a.id}` : "unassigned";
}

/**
 * Whether a task survives the filter. Cheap and pure so it can run over every
 * task on every keystroke without a fetch — see the module comment.
 */
export function taskMatchesFilter(task: Task, f: BoardFilter): boolean {
  const q = f.text.trim().toLowerCase();
  if (
    q &&
    !task.title.toLowerCase().includes(q) &&
    !task.description.toLowerCase().includes(q)
  ) {
    return false;
  }
  if (f.priorities.length > 0 && !f.priorities.includes(task.priority)) {
    return false;
  }
  if (f.labelIds.length > 0) {
    const worn = new Set(task.labels.map((l) => l.id));
    if (!f.labelIds.some((id) => worn.has(id))) return false;
  }
  if (f.assignees.length > 0 && !f.assignees.includes(actorKey(task.assignee))) {
    return false;
  }
  return true;
}

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value)
    ? list.filter((v) => v !== value)
    : [...list, value];
}

interface FacetProps {
  label: string;
  count: number;
  children: React.ReactNode;
}

/** A dropdown whose trigger shows how many of its values are selected. */
function Facet({ label, count, children }: FacetProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 font-normal text-muted-foreground data-[count]:text-foreground"
            {...(count > 0 ? { "data-count": count } : {})}
          >
            {label}
            {count > 0 && (
              <span className="rounded bg-primary/10 px-1 text-xs text-primary">
                {count}
              </span>
            )}
          </Button>
        }
      />
      <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface BoardFilterBarProps {
  filter: BoardFilter;
  onChange: (next: BoardFilter) => void;
  labels: Label[];
  members: Member[];
  agents: AgentSummary[];
  /** Tasks matching the filter, and tasks in total — the "3 of 12" readout. */
  matched: number;
  total: number;
}

export function BoardFilterBar({
  filter,
  onChange,
  labels,
  members,
  agents,
  matched,
  total,
}: BoardFilterBarProps) {
  const active = isFilterActive(filter);

  return (
    <div className="flex flex-1 flex-wrap items-center gap-2">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          type="search"
          value={filter.text}
          placeholder="Search tasks"
          aria-label="Search tasks"
          className="h-8 w-44 pl-8"
          onChange={(e) => onChange({ ...filter, text: e.target.value })}
        />
      </div>

      <Facet label="Priority" count={filter.priorities.length}>
        {PRIORITY_ORDER.map((p) => (
          <DropdownMenuCheckboxItem
            key={p}
            checked={filter.priorities.includes(p)}
            onCheckedChange={() =>
              onChange({ ...filter, priorities: toggle(filter.priorities, p) })
            }
          >
            <span className="flex-1 truncate">{PRIORITY_LABELS[p]}</span>
          </DropdownMenuCheckboxItem>
        ))}
      </Facet>

      {labels.length > 0 && (
        <Facet label="Label" count={filter.labelIds.length}>
          {labels.map((label) => (
            <DropdownMenuCheckboxItem
              key={label.id}
              checked={filter.labelIds.includes(label.id)}
              onCheckedChange={() =>
                onChange({
                  ...filter,
                  labelIds: toggle(filter.labelIds, label.id),
                })
              }
            >
              <span
                className={`size-2 shrink-0 rounded-full ${labelDotClass(label.color)}`}
                aria-hidden="true"
              />
              <span className="flex-1 truncate">{label.name}</span>
            </DropdownMenuCheckboxItem>
          ))}
        </Facet>
      )}

      <Facet label="Assignee" count={filter.assignees.length}>
        <DropdownMenuCheckboxItem
          checked={filter.assignees.includes("unassigned")}
          onCheckedChange={() =>
            onChange({
              ...filter,
              assignees: toggle(filter.assignees, "unassigned"),
            })
          }
        >
          <span className="flex-1 truncate text-muted-foreground">
            Unassigned
          </span>
        </DropdownMenuCheckboxItem>
        {members.map((m) => {
          const key = `human:${m.userId}`;
          return (
            <DropdownMenuCheckboxItem
              key={key}
              checked={filter.assignees.includes(key)}
              onCheckedChange={() =>
                onChange({ ...filter, assignees: toggle(filter.assignees, key) })
              }
            >
              <span className="flex-1 truncate">{m.name}</span>
            </DropdownMenuCheckboxItem>
          );
        })}
        {agents.map((a) => {
          const key = `agent:${a.id}`;
          return (
            <DropdownMenuCheckboxItem
              key={key}
              checked={filter.assignees.includes(key)}
              onCheckedChange={() =>
                onChange({ ...filter, assignees: toggle(filter.assignees, key) })
              }
            >
              <Bot
                className="size-3 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              <span className="flex-1 truncate">{a.name}</span>
            </DropdownMenuCheckboxItem>
          );
        })}
      </Facet>

      {active && (
        <>
          <span className="text-xs text-muted-foreground" aria-live="polite">
            {matched} of {total}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 text-muted-foreground"
            onClick={() => onChange(EMPTY_FILTER)}
          >
            <X /> Clear
          </Button>
        </>
      )}
    </div>
  );
}
