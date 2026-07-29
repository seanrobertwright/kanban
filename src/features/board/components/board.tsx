"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";

import {
  CalendarDays,
  ChartNoAxesColumn,
  Building2,
  ChevronDown,
  ClipboardList,
  Clock,
  Columns3,
  Flag,
  GanttChartSquare,
  Gauge,
  GitBranch,
  Inbox,
  Landmark,
  Layers,
  LayoutDashboard,
  LayoutTemplate,
  Lightbulb,
  List,
  Lock,
  Mail,
  Map as MapIcon,
  MoreHorizontal,
  Plus,
  Bot,
  Rocket,
  ScrollText,
  Settings,
  Share2,
  Shield,
  SlidersHorizontal,
  Tag,
  Tags,
  Target,
  Ticket,
  Users,
  Waypoints,
  Webhook,
  Zap,
} from "lucide-react";

import type { AgentSummary } from "@/features/agents/types";
import { LabelsDialog } from "@/features/labels/components/labels-dialog";
import type { Label as LabelData } from "@/features/labels/types";
import * as tasksApi from "@/features/tasks/client/api";
import { TaskCard } from "@/features/tasks/components/task-card";
import {
  TaskDialog,
  type TaskFormValues,
} from "@/features/tasks/components/task-dialog";
import type { TaskDependencyEdge } from "@/features/dependencies/types";
import type { Task } from "@/features/tasks/types";
import type {
  Board as WorkspaceBoard,
  Member,
  WorkspaceMembership,
} from "@/features/workspaces/types";
import {
  SettingsDialog,
  openSettings,
  type SettingsSection,
} from "@/features/settings/components/settings-dialog";
import { AuditLogPanel } from "@/features/admin/components/audit-log-panel";
import { EmailIntakePanel } from "@/features/admin/components/email-intake-panel";
import { PermissionsPanel } from "@/features/admin/components/permissions-panel";
import { SecurityPanel } from "@/features/admin/components/security-panel";
import { WorkspaceOverviewPanel } from "@/features/admin/components/workspace-overview-panel";
import { RepoConnectionsDialog } from "@/features/git/components/repo-connections-dialog";
import { MembersDialog } from "@/features/workspaces/components/members-dialog";
import { AgentsDialog } from "@/features/agents/components/agents-dialog";
import { WebhooksDialog } from "@/features/webhooks/components/webhooks-dialog";
import { Button } from "@/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { Input } from "@/shared/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/shared/ui/toggle-group";
import { useDensity } from "@/shared/ui/density";
import * as boardApi from "../client/api";
import { fetchBoard } from "../client/api";
import type { Column } from "../types";
import { BoardColumn } from "./board-column";
import { InsightsDialog } from "./insights-dialog";
import { ScheduleDialog } from "./schedule-dialog";
import { TimesheetDialog } from "@/features/time/components/timesheet-dialog";
import { FormsDialog } from "@/features/forms/components/forms-dialog";
import { AutomationsDialog } from "@/features/automations/components/automations-dialog";
import { RequestsView } from "@/features/requests/components/requests-view";
import { CapacityDialog } from "@/features/capacity/components/capacity-dialog";
import { BudgetDialog } from "@/features/budget/components/budget-dialog";
import { DiscoveryDialog } from "@/features/discovery/components/discovery-dialog";
import { CustomFieldsDialog } from "@/features/custom-fields/components/custom-fields-dialog";
import type { CustomField } from "@/features/custom-fields/types";
import { MilestonesDialog } from "@/features/milestones/components/milestones-dialog";
import { ReleasesDialog } from "@/features/releases/components/releases-dialog";
import type { Milestone } from "@/features/milestones/types";
import { EpicsDialog } from "@/features/epics/components/epics-dialog";
import type { Epic } from "@/features/epics/types";
import { ObjectivesDialog } from "@/features/objectives/components/objectives-dialog";
import type { Objective } from "@/features/objectives/types";
import { SprintsDialog } from "@/features/sprints/components/sprints-dialog";
import type { Sprint } from "@/features/sprints/types";
import {
  BoardFilterBar,
  EMPTY_FILTER,
  isFilterActive,
  taskMatchesFilter,
  type BoardFilter,
} from "./board-filter-bar";
import { BacklogView } from "./backlog-view";
import { CalendarView } from "./calendar-view";
import { DashboardView } from "./dashboard-view";
import { CommandPalette, type PaletteCommand } from "./command-palette";
import { GanttView } from "./gantt-view";
import { TimelineView } from "./timeline-view";
import { RoadmapView } from "./roadmap-view";
import { ListView } from "./list-view";
import { SavedViews } from "@/features/views/components/saved-views";
import type { BoardViewMode, SavedView } from "@/features/views/types";
import { TemplatesDialog } from "@/features/templates/components/templates-dialog";
import { ShareDialog } from "@/features/sharing/components/share-dialog";
import { ExtensionCatalogProvider } from "@/features/extensions/components/extension-catalog";
import type { WorkspaceExtension } from "@/features/extensions/types";
import type { TaskTemplate } from "@/features/templates/types";

/**
 * The lenses that get a tab, and the ones that get a dropdown.
 *
 * Eight equal-weight tabs said all eight views were equally likely, which is
 * not true of any board anyone works: Board and List are where the day is
 * spent, Timeline and Dashboard are the two people check. The other four are
 * real views read occasionally, and the split is the design synthesis's
 * (Board / List / Timeline / Dashboard visible, the rest tucked away).
 *
 * Tables rather than eight hand-written JSX blocks, because the same list is
 * needed twice — once to render the tabs and once to ask whether the current
 * view is a tab at all, which is what stops the ToggleGroup showing nothing
 * selected while the board renders a Gantt.
 */
const PRIMARY_VIEWS = [
  ["board", "Board", Columns3],
  ["list", "List", List],
  ["timeline", "Timeline", GanttChartSquare],
  ["dashboard", "Dashboard", LayoutDashboard],
] as const satisfies readonly (readonly [BoardViewMode, string, typeof Columns3])[];

const MORE_VIEWS = [
  ["calendar", "Calendar", CalendarDays],
  ["gantt", "Gantt", Waypoints],
  ["backlog", "Backlog", Inbox],
  ["roadmap", "Roadmap", MapIcon],
  ["requests", "Requests", Ticket],
] as const satisfies readonly (readonly [BoardViewMode, string, typeof Columns3])[];

/**
 * The letter that follows `G` to reach each lens — Gmail's and Linear's chord,
 * which is the convention people arrive already knowing.
 *
 * `k` is Backlog and `c` is Calendar because `b` and `g` were taken by Board and
 * Gantt; `q` is Requests (the *queue*) because `r` was taken by Roadmap. The
 * palette shows every binding (see chordHint), so the three that are not
 * first-letter are discoverable rather than folklore.
 */
const VIEW_CHORDS: Record<string, BoardViewMode> = {
  b: "board",
  l: "list",
  c: "calendar",
  t: "timeline",
  g: "gantt",
  k: "backlog",
  r: "roadmap",
  d: "dashboard",
  q: "requests",
};

/** The chord for a view, as the palette prints it. Derived from the same table
 *  the keydown handler reads, so a binding cannot exist without a hint. */
function chordHint(mode: BoardViewMode): string | undefined {
  const key = Object.keys(VIEW_CHORDS).find((k) => VIEW_CHORDS[k] === mode);
  return key ? `G ${key.toUpperCase()}` : undefined;
}

/**
 * Whether a keystroke belongs to whatever the user is typing in rather than to
 * the board. Without this, `c` would open the New-task dialog in the middle of
 * writing a comment containing the letter c.
 */
function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  const tag = el.tagName.toLowerCase();
  return (
    tag === "input" ||
    tag === "textarea" ||
    tag === "select" ||
    el.isContentEditable === true
  );
}

type ItemsByColumn = Record<number, Task[]>;

function groupTasks(columns: Column[], tasks: Task[]): ItemsByColumn {
  const grouped: ItemsByColumn = {};
  for (const column of columns) grouped[column.id] = [];
  for (const task of tasks) grouped[task.columnId]?.push(task);
  for (const id in grouped) {
    grouped[id].sort((a, b) => a.position - b.position);
  }
  return grouped;
}

interface BoardProps {
  boardId: number;
  columns: Column[];
  initialTasks: Task[];
  /** Everyone assignable on this board, and the source of every rendered face. */
  members: Member[];
  /**
   * The workspace's agents (011) — the other half of "everyone assignable". The
   * picker shows them beside the members, and a card resolves an agent assignee's
   * name and face from here, exactly as it does a human's from `members`.
   */
  agents: AgentSummary[];
  /**
   * The workspace's label vocabulary — the picker's options, and the source of
   * every chip's colour. Held in state rather than read straight from the prop
   * because the labels dialog can change it, and the board is what re-renders.
   */
  initialLabels: LabelData[];
  /** The vocabulary's owner — labels are workspace-scoped, not per board (007). */
  workspaceId: string;
  /** This member's private saved views for the workspace (015). */
  initialSavedViews: SavedView[];
  /**
   * The column that completes a task on this board (020), or null. Held in state
   * because an admin can change it from a column's menu, and moving a recurring
   * task into it is what spawns the successor.
   */
  initialDoneColumnId: number | null;
  /**
   * The workspace's shared task templates (019). Held in state because the
   * templates dialog can change the set, and the New-task picker reads it — the
   * same reason labels are state rather than a prop read straight through.
   */
  initialTemplates: TaskTemplate[];
  /** The board's milestones (026), progress included — state because the
   * milestones dialog edits the set and the task dialog's picker reads it. */
  initialMilestones: Milestone[];
  /** The board's epics (031), state because the EpicsDialog edits the set and
   * the task dialog's picker reads it. */
  initialEpics: Epic[];
  /** The board's sprints (028), state because the SprintsDialog edits the set
   * and the task dialog's picker reads it. */
  initialSprints: Sprint[];
  /** The board's blocked-by edges (036), for the Gantt's arrows + critical path.
   * State because the task dialog adds and removes edges and `refresh()` re-reads
   * the whole board — the milestone/epic pattern, so the Gantt redraws its arrows
   * the moment a dependency changes rather than on a full page reload. */
  initialDependencies: TaskDependencyEdge[];
  /** The board's custom-field definitions (035 → 036 follow-up), state because
   * the manager dialog edits the set and cards + list columns read them. */
  initialCustomFields: CustomField[];
  /** The board's objectives + key results (037), state because the
   * ObjectivesDialog edits them and the task dialog's picker reads them. */
  initialObjectives: Objective[];
  /**
   * The workspace's installed extensions (8.1). A prop read straight through,
   * not state: nothing on the board installs or removes one — that is the
   * Settings surface, which reloads the page.
   *
   * It is here rather than fetched by the components that render it because
   * every card mounts a `card_badge` slot, and a workspace-scoped list asked
   * for once per card is the same answer N times over.
   */
  extensions: WorkspaceExtension[];
  /** False for viewers. The server enforces this too — this only hides the UI. */
  canEdit: boolean;
  /**
   * Admin and up. Only deletion needs the extra rank: creating and renaming are
   * cheap and reversible, deleting can destroy work (§7.4's blast-radius rule,
   * applied to people). The server enforces both — these only hide the UI.
   */
  canDeleteColumns: boolean;
  /**
   * Who is looking. The timesheet needs it — you may submit your own week and
   * nobody else's, so a row has to know whether it is yours (083) — and so does
   * the Settings surface's Members section.
   */
  currentUserId: string;
  /**
   * This member's standing in the workspace, and the workspace's other boards.
   * Both exist for the Settings surface: its Workspace group hosts members,
   * agents, webhooks and the admin console, and those panels are workspace-wide
   * even though the door to them is on a board.
   */
  workspace: WorkspaceMembership;
  boards: WorkspaceBoard[];
}

interface DialogState {
  columnId: number;
  task?: Task;
  /**
   * The parent, when the dialog is showing one of its subtasks. Set only while
   * navigated into a piece — it powers the "back" affordance and is why a piece
   * can be reached at all, since none of them are on the board (008).
   */
  parent?: Task;
}

export function Board({
  boardId,
  columns,
  initialTasks,
  members,
  agents,
  initialLabels,
  workspaceId,
  initialSavedViews,
  initialDoneColumnId,
  initialTemplates,
  initialMilestones,
  initialEpics,
  initialSprints,
  initialDependencies,
  initialCustomFields,
  initialObjectives,
  extensions,
  canEdit,
  canDeleteColumns,
  currentUserId,
  workspace,
  boards,
}: BoardProps) {
  // Columns are state now rather than a prop read straight through: they stopped
  // being seed data at M1 and the board edits them in place. page.tsx keys this
  // component by board id, so switching boards remounts rather than leaving this
  // state describing the board you just left.
  const [cols, setCols] = useState<Column[]>(columns);
  const [items, setItems] = useState<ItemsByColumn>(() =>
    groupTasks(columns, initialTasks)
  );
  const [error, setError] = useState<string | null>(null);
  const [addingColumn, setAddingColumn] = useState(false);
  const [newColumnTitle, setNewColumnTitle] = useState("");
  const columnNames = useMemo(
    () => Object.fromEntries(cols.map((c) => [c.id, c.title])),
    [cols]
  );
  const membersById = useMemo(
    () => Object.fromEntries(members.map((m) => [m.userId, m])),
    [members]
  );
  const agentsById = useMemo(
    () => Object.fromEntries(agents.map((a) => [a.id, a])),
    [agents]
  );
  const [labels, setLabels] = useState<LabelData[]>(initialLabels);
  const [templates, setTemplates] = useState<TaskTemplate[]>(initialTemplates);
  /**
   * The open Settings section, or null for closed — one piece of state where
   * there were ten `somethingOpen` booleans. Every configurable thing (the
   * workspace's people and integrations, the board's vocabulary and rules, the
   * plan's sprints and milestones) now lives behind this, which is what makes
   * the overflow menu two groups shorter and stops a config panel from opening
   * on top of another modal.
   */
  const [settingsSection, setSettingsSection] = useState<string | null>(null);
  const [insightsOpen, setInsightsOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [timesheetOpen, setTimesheetOpen] = useState(false);
  const [capacityOpen, setCapacityOpen] = useState(false);
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [discoveryOpen, setDiscoveryOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [milestones, setMilestones] = useState<Milestone[]>(initialMilestones);
  const [epics, setEpics] = useState<Epic[]>(initialEpics);
  const [objectives, setObjectives] =
    useState<Objective[]>(initialObjectives);
  const [sprints, setSprints] = useState<Sprint[]>(initialSprints);
  const [dependencies, setDependencies] =
    useState<TaskDependencyEdge[]>(initialDependencies);
  const [customFields, setCustomFields] =
    useState<CustomField[]>(initialCustomFields);
  const customFieldsById = useMemo(
    () => Object.fromEntries(customFields.map((f) => [f.id, f])),
    [customFields]
  );
  const [doneColumnId, setDoneColumnId] = useState<number | null>(
    initialDoneColumnId
  );
  const labelsById = useMemo(
    () => Object.fromEntries(labels.map((l) => [l.id, l])),
    [labels]
  );
  const [density, setDensity] = useDensity();
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [dialog, setDialog] = useState<DialogState | null>(null);

  // Which lens the same tasks are shown through. The board is the only one that
  // can drag; list and calendar are read-and-open. Filtering (below) applies to
  // all three — they are all fed `visibleItems`.
  const [view, setView] = useState<BoardViewMode>("board");
  const [savedViews, setSavedViews] = useState<SavedView[]>(initialSavedViews);

  // A view over `items`, not a second copy of it. Filtering is purely client-side
  // (every task is already loaded) so it costs nothing to recompute per keystroke.
  const [filter, setFilter] = useState<BoardFilter>(EMPTY_FILTER);
  const filtering = isFilterActive(filter);
  const visibleItems = useMemo(() => {
    if (!filtering) return items;
    const out: ItemsByColumn = {};
    for (const id in items) {
      out[id] = items[id].filter((t) => taskMatchesFilter(t, filter));
    }
    return out;
  }, [items, filter, filtering]);
  const totalCount = useMemo(
    () => Object.values(items).reduce((n, list) => n + list.length, 0),
    [items]
  );
  const matchedCount = useMemo(
    () => Object.values(visibleItems).reduce((n, list) => n + list.length, 0),
    [visibleItems]
  );
  // The backlog lens groups by sprint, not column, so it wants the visible
  // tasks as one flat list rather than the per-column buckets the other lenses
  // read. Same source, different cut.
  const visibleTaskList = useMemo(
    () => Object.values(visibleItems).flat(),
    [visibleItems]
  );

  const sensors = useSensors(
    // The distance constraint lets plain clicks reach buttons inside cards
    // instead of being swallowed as drag starts.
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const refresh = useCallback(async () => {
    try {
      const data = await fetchBoard(boardId);
      setCols(data.columns);
      setItems(groupTasks(data.columns, data.tasks));
      setDoneColumnId(data.doneColumnId);
      setMilestones(data.milestones);
      setEpics(data.epics);
      setSprints(data.sprints);
      setDependencies(data.dependencies);
      setCustomFields(data.customFields);
      setObjectives(data.objectives);
    } catch {
      // Keep optimistic state if the server is unreachable.
    }
  }, [boardId]);

  function findColumnId(dndId: string): number | undefined {
    if (dndId.startsWith("col-")) return Number(dndId.slice(4));
    const taskId = Number(dndId.slice(5));
    for (const [columnId, tasks] of Object.entries(items)) {
      if (tasks.some((t) => t.id === taskId)) return Number(columnId);
    }
    return undefined;
  }

  function handleDragStart(event: DragStartEvent) {
    const id = String(event.active.id);
    const columnId = findColumnId(id);
    if (columnId === undefined) return;
    const task = items[columnId].find((t) => `task-${t.id}` === id) ?? null;
    setActiveTask(task);
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);

    const sourceColumnId = findColumnId(activeId);
    const targetColumnId = findColumnId(overId);
    if (
      sourceColumnId === undefined ||
      targetColumnId === undefined ||
      sourceColumnId === targetColumnId
    ) {
      return;
    }

    // Move the task into the hovered column locally; positions are
    // persisted once on drag end.
    setItems((prev) => {
      const source = [...prev[sourceColumnId]];
      const target = [...prev[targetColumnId]];
      const fromIndex = source.findIndex((t) => `task-${t.id}` === activeId);
      if (fromIndex === -1) return prev;
      const [task] = source.splice(fromIndex, 1);
      const overIndex = overId.startsWith("col-")
        ? target.length
        : target.findIndex((t) => `task-${t.id}` === overId);
      const insertAt = overIndex === -1 ? target.length : overIndex;
      target.splice(insertAt, 0, { ...task, columnId: targetColumnId });
      return { ...prev, [sourceColumnId]: source, [targetColumnId]: target };
    });
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveTask(null);
    const { active, over } = event;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);

    // By drag end, handleDragOver has already parked the task in its
    // destination column — only in-column reordering remains.
    const columnId = findColumnId(activeId);
    if (columnId === undefined) return;
    const columnTasks = items[columnId];
    const fromIndex = columnTasks.findIndex(
      (t) => `task-${t.id}` === activeId
    );
    if (fromIndex === -1) return;

    let toIndex = fromIndex;
    if (!overId.startsWith("col-") && overId !== activeId) {
      const overIndex = columnTasks.findIndex(
        (t) => `task-${t.id}` === overId
      );
      if (overIndex !== -1) toIndex = overIndex;
    }

    if (fromIndex !== toIndex) {
      setItems((prev) => ({
        ...prev,
        [columnId]: arrayMove(prev[columnId], fromIndex, toIndex),
      }));
    }

    const task = columnTasks[fromIndex];
    tasksApi
      .moveTask(task.id, { columnId, position: toIndex })
      .then(() => {
        // A recurring task landing in the done column spawns its successor
        // server-side (020) — which the optimistic board knows nothing about, so
        // it refetches to reveal the new occurrence and the now-non-recurring one.
        if (task.recurrence && columnId === doneColumnId) void refresh();
      })
      .catch(refresh);
  }

  function handleSetDoneColumn(columnId: number) {
    // A toggle: naming the current done column again clears the designation.
    const next = doneColumnId === columnId ? null : columnId;
    setDoneColumnId(next);
    boardApi.setDoneColumn(boardId, next).catch((e) => {
      setError(e instanceof Error ? e.message : "Could not set the done column");
      void refresh();
    });
  }

  async function handleDialogSubmit(values: TaskFormValues) {
    if (!dialog) return;
    try {
      if (dialog.task) {
        const updated = await tasksApi.updateTask(dialog.task.id, values);
        setItems((prev) => ({
          ...prev,
          [updated.columnId]: (prev[updated.columnId] ?? []).map((t) =>
            t.id === updated.id ? { ...t, ...updated } : t
          ),
        }));
      } else {
        const created = await tasksApi.createTask({
          columnId: dialog.columnId,
          ...values,
        });
        setItems((prev) => ({
          ...prev,
          [created.columnId]: [...(prev[created.columnId] ?? []), created],
        }));
      }
      setDialog(null);
    } catch {
      refresh();
      setDialog(null);
    }
  }

  function handleDelete(task: Task) {
    setItems((prev) => ({
      ...prev,
      [task.columnId]: (prev[task.columnId] ?? []).filter(
        (t) => t.id !== task.id
      ),
    }));
    tasksApi.deleteTask(task.id).catch(refresh);
  }

  // Backlog planning: scheduling a task into a sprint (or null, back to the
  // backlog) changes only its sprint_id, not its column — so the task stays put
  // in `items`, its sprintId updated in place. The board refetches on failure,
  // which is where a refused schedule (a completed or cross-board sprint, which
  // the backlog lens does not offer as a target) would surface.
  function handleAssignSprint(task: Task, sprintId: number | null) {
    setItems((prev) => ({
      ...prev,
      [task.columnId]: (prev[task.columnId] ?? []).map((t) =>
        t.id === task.id ? { ...t, sprintId } : t
      ),
    }));
    tasksApi.updateTask(task.id, { sprintId }).catch(refresh);
  }

  async function handleAddColumn() {
    const title = newColumnTitle.trim();
    if (!title) return;
    try {
      const created = await boardApi.createColumn(boardId, title);
      setCols((prev) => [...prev, created]);
      setItems((prev) => ({ ...prev, [created.id]: [] }));
      setNewColumnTitle("");
      setAddingColumn(false);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add the column");
    }
  }

  function handleRenameColumn(column: Column, title: string) {
    setCols((prev) =>
      prev.map((c) => (c.id === column.id ? { ...c, title } : c))
    );
    boardApi.renameColumn(column.id, title).catch((e) => {
      setError(e instanceof Error ? e.message : "Could not rename the column");
      refresh();
    });
  }

  function handleSetWipLimit(column: Column, wipLimit: number | null) {
    setCols((prev) =>
      prev.map((c) => (c.id === column.id ? { ...c, wipLimit } : c))
    );
    boardApi.setColumnWipLimit(column.id, wipLimit).catch((e) => {
      setError(e instanceof Error ? e.message : "Could not set the WIP limit");
      refresh();
    });
  }

  function handleMoveColumn(column: Column, by: -1 | 1) {
    const from = cols.findIndex((c) => c.id === column.id);
    const to = from + by;
    if (from === -1 || to < 0 || to >= cols.length) return;
    setCols((prev) => arrayMove(prev, from, to));
    boardApi.moveColumn(column.id, to).catch((e) => {
      setError(e instanceof Error ? e.message : "Could not move the column");
      refresh();
    });
  }

  /**
   * The one column mutation that is NOT optimistic, and deliberately.
   *
   * The server refuses to delete a column that still holds tasks — that 409 is
   * the expected answer, not an edge case. Removing the column on click and
   * putting it back a moment later would make the ordinary path look like a
   * glitch, and would flash the tasks out of existence on their way. So this
   * waits, and on refusal shows the server's sentence, which already says how
   * many tasks are in the way.
   */
  async function handleDeleteColumn(column: Column) {
    try {
      await boardApi.deleteColumn(column.id);
      setCols((prev) => prev.filter((c) => c.id !== column.id));
      setItems((prev) => {
        const next = { ...prev };
        delete next[column.id];
        return next;
      });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete the column");
    }
  }

  /**
   * The Settings surface's sections, in nav order.
   *
   * Each `render` returns the feature's existing dialog with `open` pinned
   * true — inside the surface's InlineDialogHost that dialog renders as a plain
   * region, so none of these fifteen components needed changing to become a
   * settings page. `onOpenChange(false)` closes the surface, which is what a
   * panel's own Close button now means.
   *
   * The thunk matters: only the showing section is called, so opening Settings
   * fetches one panel's data rather than fifteen.
   */
  const close = useCallback(() => setSettingsSection(null), []);
  // Administration is admin+, and each of its panels refuses below that rank
  // server-side. The nav simply stops advertising doors that would not open.
  const isAdmin = workspace.role === "owner" || workspace.role === "admin";
  const settingsSections = useMemo<SettingsSection[]>(
    () => [
      ...(isAdmin
        ? [
            {
              id: "overview",
              label: "Overview",
              group: "Workspace",
              icon: Building2,
              description: "What this workspace currently contains.",
              render: () => <WorkspaceOverviewPanel workspace={workspace} />,
            } satisfies SettingsSection,
          ]
        : []),
      {
        id: "members",
        label: "Members",
        group: "Workspace",
        icon: Users,
        description: "Who is in this workspace, and what they may do.",
        render: () => (
          <MembersDialog
            open
            onOpenChange={close}
            workspace={workspace}
            currentUserId={currentUserId}
          />
        ),
      },
      {
        id: "agents",
        label: "Agents",
        group: "Workspace",
        icon: Bot,
        description: "The non-human members, their keys and their limits.",
        render: () => (
          <AgentsDialog open onOpenChange={close} workspace={workspace} />
        ),
      },
      {
        id: "webhooks",
        label: "Webhooks",
        group: "Workspace",
        icon: Webhook,
        description: "Where activity is delivered, and what happened to it.",
        render: () => (
          <WebhooksDialog open onOpenChange={close} workspace={workspace} />
        ),
      },
      // The old admin console's five topics, each now its own section. It used
      // to stack them in one scrolling modal that opened Members, Agents and
      // Webhooks as modals on top of itself — the three sections above.
      ...(isAdmin
        ? ([
            {
              id: "permissions",
              label: "Permissions",
              group: "Workspace",
              icon: Shield,
              description: "Who may reach which board, and which field.",
              render: () => (
                <PermissionsPanel workspace={workspace} boards={boards} />
              ),
            },
            {
              id: "repositories",
              label: "Repositories",
              group: "Workspace",
              icon: GitBranch,
              description: "The code repositories this workspace links work to.",
              render: () => (
                <RepoConnectionsDialog
                  open
                  onOpenChange={close}
                  workspace={workspace}
                />
              ),
            },
            {
              id: "intake",
              label: "Email intake",
              group: "Workspace",
              icon: Mail,
              description: "The inbound address that files mail as tasks.",
              render: () => <EmailIntakePanel workspace={workspace} />,
            },
            {
              id: "audit",
              label: "Audit log",
              group: "Workspace",
              icon: ScrollText,
              description: "Every action taken here, by people and by agents.",
              render: () => <AuditLogPanel workspace={workspace} boards={boards} />,
            },
            {
              id: "security",
              label: "Security & compliance",
              group: "Workspace",
              icon: Lock,
              description:
                "Network policy, retention, legal holds, identity and integrations.",
              render: () => <SecurityPanel workspace={workspace} />,
            },
          ] satisfies SettingsSection[])
        : []),
      {
        id: "labels",
        label: "Labels",
        group: "Board",
        icon: Tags,
        description: "The workspace's label vocabulary (007).",
        render: () => (
          <LabelsDialog
            open
            onOpenChange={close}
            workspaceId={workspaceId}
            labels={labels}
            canEdit={canEdit}
            canDelete={canDeleteColumns}
            onChanged={(next) => {
              setLabels(next);
              void refresh();
            }}
          />
        ),
      },
      {
        id: "fields",
        label: "Custom fields",
        group: "Board",
        icon: SlidersHorizontal,
        description: "Extra facts this board records on a task.",
        render: () => (
          <CustomFieldsDialog
            open
            onOpenChange={close}
            boardId={boardId}
            canEdit={canEdit}
            onChanged={refresh}
          />
        ),
      },
      {
        id: "templates",
        label: "Templates",
        group: "Board",
        icon: LayoutTemplate,
        description: "Starting points the New-task form can be filled from.",
        render: () => (
          <TemplatesDialog
            open
            onOpenChange={close}
            workspaceId={workspaceId}
            templates={templates}
            labels={labels}
            canEdit={canEdit}
            onChanged={setTemplates}
          />
        ),
      },
      {
        id: "automations",
        label: "Automations",
        group: "Board",
        icon: Zap,
        description: "Rules that act on this board without being asked.",
        render: () => (
          <AutomationsDialog
            open
            onOpenChange={close}
            boardId={boardId}
            workspaceId={workspaceId}
            columns={cols}
            labels={labels}
            canManage={canDeleteColumns}
            onChanged={refresh}
          />
        ),
      },
      {
        id: "forms",
        label: "Forms",
        group: "Board",
        icon: ClipboardList,
        description: "Intake forms that file straight into a column.",
        render: () => (
          <FormsDialog
            open
            onOpenChange={close}
            boardId={boardId}
            columns={cols}
            canEdit={canEdit}
            onSubmitted={refresh}
          />
        ),
      },
      {
        id: "sprints",
        label: "Sprints",
        group: "Planning",
        icon: Rocket,
        description: "The board's iterations and their scope (028).",
        render: () => (
          <SprintsDialog
            open
            onOpenChange={close}
            boardId={boardId}
            canEdit={canEdit}
            membersById={membersById}
            agentsById={agentsById}
            onChanged={refresh}
          />
        ),
      },
      {
        id: "milestones",
        label: "Milestones",
        group: "Planning",
        icon: Flag,
        description: "Checkpoints work aims at (026).",
        render: () => (
          <MilestonesDialog
            open
            onOpenChange={close}
            boardId={boardId}
            milestones={milestones}
            epics={epics}
            objectives={objectives}
            canEdit={canEdit}
            onChanged={refresh}
          />
        ),
      },
      {
        id: "releases",
        label: "Releases",
        group: "Planning",
        icon: Tag,
        description: "What shipped, and what is in the next one.",
        render: () => (
          <ReleasesDialog
            open
            onOpenChange={close}
            boardId={boardId}
            tasks={visibleTaskList.map((t) => ({ id: t.id, title: t.title }))}
            canEdit={canEdit}
            onChanged={refresh}
          />
        ),
      },
      {
        id: "epics",
        label: "Epics",
        group: "Planning",
        icon: Layers,
        description: "The coarse groupings tasks are filed under (031).",
        render: () => (
          <EpicsDialog
            open
            onOpenChange={close}
            boardId={boardId}
            epics={epics}
            members={members}
            canEdit={canEdit}
            onChanged={refresh}
          />
        ),
      },
      {
        id: "objectives",
        label: "Objectives",
        group: "Planning",
        icon: Target,
        description: "Outcomes and the key results measuring them (037).",
        render: () => (
          <ObjectivesDialog
            open
            onOpenChange={close}
            boardId={boardId}
            objectives={objectives}
            canEdit={canEdit}
            onChanged={refresh}
          />
        ),
      },
    ],
    [
      close,
      isAdmin,
      workspace,
      currentUserId,
      boards,
      workspaceId,
      boardId,
      labels,
      templates,
      cols,
      milestones,
      epics,
      objectives,
      // The epics dialog picks an owner from the roster (089), so the memo has
      // to see a changed roster — membersById below is a different value.
      members,
      membersById,
      agentsById,
      visibleTaskList,
      canEdit,
      canDeleteColumns,
      refresh,
    ]
  );

  /**
   * Keyboard chords: `C` to create, `G` then a letter to change lens, `G S` for
   * settings.
   *
   * A ref rather than state for the pending `G`: nothing renders differently
   * while a chord is half-typed, and state here would re-render the whole board
   * on every keystroke that reached it. The chord expires after a second and a
   * half, so a stray G does not silently arm the next letter you type minutes
   * later.
   *
   * Anything with a dialog open is off limits — the check is for a rendered
   * dialog rather than this component's own state, so the palette, a confirm,
   * and a panel opened by some other component all suppress the chords without
   * this effect having to know they exist.
   */
  const chord = useRef<{ key: string; at: number } | null>(null);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      if (document.querySelector('[data-slot="dialog-content"]')) return;
      const key = e.key.toLowerCase();
      const pending =
        chord.current && e.timeStamp - chord.current.at < 1500
          ? chord.current.key
          : null;
      chord.current = null;

      if (pending === "g") {
        if (key === "s") {
          e.preventDefault();
          openSettings();
          return;
        }
        const mode = VIEW_CHORDS[key];
        if (mode) {
          e.preventDefault();
          setView(mode);
        }
        return;
      }
      if (key === "g") {
        chord.current = { key: "g", at: e.timeStamp };
        return;
      }
      if (key === "c" && canEdit && cols.length > 0) {
        e.preventDefault();
        setDialog({ columnId: cols[0].id });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canEdit, cols]);

  // The ⌘K palette's verbs. Everything here reuses state the board already
  // owns — a command is just a named setState — so the palette adds reach,
  // not a second way of doing anything.
  const paletteCommands = useMemo<PaletteCommand[]>(() => {
    // The hints are the chords VIEW_CHORDS binds (see the keydown effect):
    // the palette is where someone discovers that G B exists, so the two lists
    // are written from the same shape rather than kept in sync by hand.
    const views: [BoardViewMode, string][] = [
      ["board", "Go to Board"],
      ["list", "Go to List"],
      ["calendar", "Go to Calendar"],
      ["timeline", "Go to Timeline"],
      ["gantt", "Go to Gantt"],
      ["backlog", "Go to Backlog"],
      ["roadmap", "Go to Roadmap"],
      ["dashboard", "Go to Dashboard"],
      ["requests", "Go to Requests"],
    ];
    const panels: [string, () => void][] = [
      ["Insights", () => setInsightsOpen(true)],
      ["Schedule", () => setScheduleOpen(true)],
      ["Timesheet", () => setTimesheetOpen(true)],
      ["Capacity", () => setCapacityOpen(true)],
      ["Budget", () => setBudgetOpen(true)],
      ["Discovery", () => setDiscoveryOpen(true)],
    ];
    return [
      ...(canEdit && cols.length > 0
        ? [
            {
              id: "new-task",
              label: "Create new task",
              group: "Create",
              hint: "C",
              run: () => setDialog({ columnId: cols[0].id }),
            },
          ]
        : []),
      ...views.map(([mode, label]) => ({
        id: `view-${mode}`,
        label,
        group: "Views",
        hint: chordHint(mode),
        run: () => setView(mode),
      })),
      ...panels.map(([label, run]) => ({
        id: `panel-${label}`,
        label: `Open ${label}`,
        group: "Panels",
        run,
      })),
      // Every settings section is its own command, so "Labels" still reaches
      // labels in one step now that the door is a shared surface — a
      // consolidation that cost people a keystroke would not be one.
      {
        id: "settings",
        label: "Open Settings",
        group: "Settings",
        hint: "G S",
        run: () => openSettings(),
      },
      ...settingsSections.map((s) => ({
        id: `settings-${s.id}`,
        label: `Settings: ${s.label}`,
        group: "Settings",
        hint: s.group,
        run: () => setSettingsSection(s.id),
      })),
    ];
  }, [canEdit, cols, settingsSections]);

  return (
    // Every card badge and task panel below reads its extensions from here
    // instead of asking the server for the same workspace-scoped list once per
    // card. The board is the right height for it: the list is identical for
    // every card, and switching boards remounts this component anyway.
    <ExtensionCatalogProvider extensions={extensions}>
      <CommandPalette
        commands={paletteCommands}
        tasks={visibleTaskList}
        onOpenTask={(task) => setDialog({ columnId: task.columnId, task })}
      />
      {error && (
        <p
          role="alert"
          className="rounded-lg border border-destructive/50 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      )}
      {/* Above the board, not inside a column: the vocabulary belongs to the
          workspace (007), so hanging it off a column's menu — where the column
          actions live — would say it belonged to this board. Viewers see it too;
          reading the vocabulary is not an edit, and the dialog hides its own
          controls. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <BoardFilterBar
          filter={filter}
          onChange={setFilter}
          labels={labels}
          members={members}
          agents={agents}
          matched={matchedCount}
          total={totalCount}
        />
        <div className="flex flex-wrap items-center gap-2">
          <SavedViews
            workspaceId={workspaceId}
            views={savedViews}
            onViewsChange={setSavedViews}
            currentView={view}
            currentFilter={filter}
            onApply={(v) => {
              setView(v.viewMode);
              setFilter(v.filter);
            }}
          />
          {/* Four view tabs, not eight (design synthesis).
              Board / List / Timeline / Dashboard are the lenses people live in;
              Calendar, Gantt, Backlog and Roadmap are real views that are read
              occasionally, and eight equal-weight tabs made all of them look
              equally likely. The dropdown keeps them one click away and takes
              the active one's name onto its trigger, so the switcher never lies
              about which lens you are in. */}
          <ToggleGroup
            value={[PRIMARY_VIEWS.some(([m]) => m === view) ? view : ""]}
            onValueChange={(v) => {
              // Single-select, but base-ui hands back an array; ignore the empty
              // case so clicking the active lens does not deselect into nothing.
              if (v[0]) setView(v[0] as BoardViewMode);
            }}
          >
            {PRIMARY_VIEWS.map(([mode, label, Icon]) => (
              <ToggleGroupItem key={mode} value={mode}>
                <Icon /> {label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant={MORE_VIEWS.some(([m]) => m === view) ? "secondary" : "ghost"}
                  size="sm"
                  className="text-muted-foreground"
                >
                  {MORE_VIEWS.find(([m]) => m === view)?.[1] ?? "More views"}
                  <ChevronDown />
                </Button>
              }
            />
            <DropdownMenuContent align="end">
              {MORE_VIEWS.map(([mode, label, Icon]) => (
                <DropdownMenuItem key={mode} onClick={() => setView(mode)}>
                  <Icon /> {label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          {canEdit && cols.length > 0 && (
            <Button size="sm" onClick={() => setDialog({ columnId: cols[0].id })}>
              <Plus /> New task
            </Button>
          )}
          {/* One overflow menu in place of seventeen flat ghost buttons.
              Every entry below already had a ⌘K command (paletteCommands), so
              the palette was always the fast path and the toolbar was a wall of
              equally-weighted verbs nobody could scan. This is the mouse path to
              the same set, grouped by what the thing is *for* rather than by the
              order the features happened to land in. */}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground"
                  aria-label="Board tools"
                >
                  <MoreHorizontal />
                </Button>
              }
            />
            <DropdownMenuContent align="end" className="max-h-[70vh] overflow-y-auto">
              {/* Eleven entries became one door. Sprints, milestones, labels,
                  fields, templates, automations, forms and the rest are all
                  "set this board up", and listing them here made configuring
                  look like eleven unrelated errands. They are sections of
                  Settings now — the palette still names each one directly, so
                  nothing moved further away than a menu. */}
              <DropdownMenuItem onClick={() => openSettings()}>
                <Settings /> Settings…
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setScheduleOpen(true)}>
                <Clock /> Schedule
              </DropdownMenuItem>

              <DropdownMenuSeparator />
              <DropdownMenuLabel>Measure</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => setInsightsOpen(true)}>
                <ChartNoAxesColumn /> Insights
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTimesheetOpen(true)}>
                <Clock /> Timesheet
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setCapacityOpen(true)}>
                <Gauge /> Capacity
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setBudgetOpen(true)}>
                <Landmark /> Budget
              </DropdownMenuItem>

              <DropdownMenuSeparator />
              <DropdownMenuLabel>Intake</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => setView("requests")}>
                <Ticket /> Requests
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setDiscoveryOpen(true)}>
                <Lightbulb /> Discovery
              </DropdownMenuItem>

              <DropdownMenuSeparator />
              {/* Sharing is minting capabilities, an admin-only power server-side —
                  the same rank canDeleteColumns proves, so it doubles as the gate. */}
              {canDeleteColumns && (
                <DropdownMenuItem onClick={() => setShareOpen(true)}>
                  <Share2 /> Share…
                </DropdownMenuItem>
              )}
              {/* Export is a GET the browser can follow — plain anchors, so the
                  download rides the session cookie with no fetch-and-blob dance.
                  Viewer+: an export is a read of what the board already shows. */}
              <DropdownMenuItem
                render={<a href={`/api/board/${boardId}/export?format=csv`}>Export CSV</a>}
              />
              <DropdownMenuItem
                render={<a href={`/api/board/${boardId}/export?format=json`}>Export JSON</a>}
              />

              <DropdownMenuSeparator />
              <DropdownMenuLabel>Density</DropdownMenuLabel>
              {/* A per-browser reading preference, not a board setting: it says
                  how much of the screen this person wants a row to take, which
                  is about their eyes and their monitor rather than about the
                  work. Stored locally for the same reason. */}
              {(["comfortable", "compact"] as const).map((value) => (
                <DropdownMenuItem
                  key={value}
                  onClick={() => setDensity(value)}
                  aria-current={density === value ? "true" : undefined}
                >
                  <span className="w-3 text-primary" aria-hidden>
                    {density === value ? "✓" : ""}
                  </span>
                  {value === "compact" ? "Compact" : "Comfortable"}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {view === "list" ? (
        <ListView
          columns={cols}
          itemsByColumn={visibleItems}
          membersById={membersById}
          agentsById={agentsById}
          labelsById={labelsById}
          customFieldsById={customFieldsById}
          members={members}
          agents={agents}
          canEdit={canEdit}
          onEditTask={(task) => setDialog({ columnId: task.columnId, task })}
          onChanged={refresh}
          filtering={filtering}
          onClearFilter={() => setFilter(EMPTY_FILTER)}
          onNewTask={
            canEdit && cols.length > 0
              ? () => setDialog({ columnId: cols[0].id })
              : undefined
          }
        />
      ) : view === "calendar" ? (
        <CalendarView
          columns={cols}
          itemsByColumn={visibleItems}
          membersById={membersById}
          agentsById={agentsById}
          labelsById={labelsById}
          onEditTask={(task) => setDialog({ columnId: task.columnId, task })}
        />
      ) : view === "timeline" ? (
        <TimelineView
          columns={cols}
          itemsByColumn={visibleItems}
          membersById={membersById}
          agentsById={agentsById}
          labelsById={labelsById}
          onEditTask={(task) => setDialog({ columnId: task.columnId, task })}
        />
      ) : view === "gantt" ? (
        <GanttView
          columns={cols}
          itemsByColumn={visibleItems}
          membersById={membersById}
          agentsById={agentsById}
          labelsById={labelsById}
          dependencies={dependencies}
          onEditTask={(task) => setDialog({ columnId: task.columnId, task })}
        />
      ) : view === "backlog" ? (
        <BacklogView
          tasks={visibleTaskList}
          sprints={sprints}
          membersById={membersById}
          agentsById={agentsById}
          labelsById={labelsById}
          canEdit={canEdit}
          onEditTask={(task) => setDialog({ columnId: task.columnId, task })}
          onAssignSprint={handleAssignSprint}
        />
      ) : view === "roadmap" ? (
        <RoadmapView
          milestones={milestones}
          epics={epics}
          onOpenMilestones={() => setSettingsSection("milestones")}
        />
      ) : view === "requests" ? (
        <RequestsView
          boardId={boardId}
          columns={cols}
          membersById={membersById}
          agentsById={agentsById}
          canEdit={canEdit}
          // The lens knows a request by task id; the task dialog wants the task
          // itself, which the board already holds — so the lookup happens here,
          // where the items live, rather than in a second fetch over there.
          onOpenRequest={(taskId, columnId) => {
            const task = (items[columnId] ?? []).find((t) => t.id === taskId);
            if (task) setDialog({ columnId, task });
          }}
        />
      ) : view === "dashboard" ? (
        <DashboardView
          columns={cols}
          itemsByColumn={visibleItems}
          doneColumnId={doneColumnId}
          onEditTask={(task) => setDialog({ columnId: task.columnId, task })}
        />
      ) : (
        <DndContext
        id="board-dnd"
        // No sensors means nothing can start a drag — the read-only path, and
        // also the filtered path: reordering a subset would write positions
        // computed against gaps the hidden tasks still occupy. Clear the filter
        // to rearrange.
        sensors={canEdit && !filtering ? sensors : []}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveTask(null)}
      >
        <div className="flex items-start gap-4 overflow-x-auto pb-4">
          {cols.map((column, index) => (
            <BoardColumn
              key={column.id}
              column={column}
              tasks={visibleItems[column.id] ?? []}
              membersById={membersById}
              agentsById={agentsById}
              labelsById={labelsById}
              customFieldsById={customFieldsById}
              canEdit={canEdit}
              canDelete={canDeleteColumns}
              isDone={column.id === doneColumnId}
              onToggleDone={() => handleSetDoneColumn(column.id)}
              isFirst={index === 0}
              isLast={index === cols.length - 1}
              onAddTask={() => setDialog({ columnId: column.id })}
              onEditTask={(task) =>
                setDialog({ columnId: task.columnId, task })
              }
              onDeleteTask={handleDelete}
              onRename={(title) => handleRenameColumn(column, title)}
              onSetWipLimit={(limit) => handleSetWipLimit(column, limit)}
              onMove={(by) => handleMoveColumn(column, by)}
              onDelete={() => handleDeleteColumn(column)}
            />
          ))}
          {canEdit && (
            <div className="w-72 shrink-0">
              {addingColumn ? (
                <div className="grid gap-1.5 rounded-xl border bg-muted/50 p-2">
                  <Input
                    value={newColumnTitle}
                    autoFocus
                    aria-label="New column title"
                    placeholder="Column name"
                    className="h-8"
                    onChange={(e) => setNewColumnTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void handleAddColumn();
                      if (e.key === "Escape") {
                        setNewColumnTitle("");
                        setAddingColumn(false);
                      }
                    }}
                  />
                  <div className="flex gap-1.5">
                    <Button
                      size="sm"
                      disabled={!newColumnTitle.trim()}
                      onClick={handleAddColumn}
                    >
                      Add
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setNewColumnTitle("");
                        setAddingColumn(false);
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start text-muted-foreground"
                  onClick={() => setAddingColumn(true)}
                >
                  <Plus /> Add column
                </Button>
              )}
            </div>
          )}
        </div>
        <DragOverlay>
          {activeTask ? (
            <TaskCard
              task={activeTask}
              membersById={membersById}
              agentsById={agentsById}
              labelsById={labelsById}
            />
          ) : null}
        </DragOverlay>
      </DndContext>
      )}
      <TaskDialog
        open={dialog !== null}
        task={dialog?.task}
        parentTask={dialog?.parent}
        columnNames={columnNames}
        columns={cols}
        members={members}
        agents={agents}
        labels={labels}
        templates={templates}
        milestones={milestones}
        epics={epics}
        objectives={objectives}
        sprints={sprints}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        onSubmit={handleDialogSubmit}
        // Opening a piece keeps the dialog open and swaps the task inside it,
        // stashing the current one as the parent to return to. Depth is 1, so the
        // task being opened is always top-level — there is no deeper stack.
        onOpenSubtask={(sub) =>
          setDialog((prev) => ({
            columnId: sub.columnId,
            task: sub,
            parent: prev?.task,
          }))
        }
        onBack={() =>
          setDialog((prev) =>
            prev?.parent
              ? { columnId: prev.parent.columnId, task: prev.parent }
              : prev
          )
        }
        // A piece's status is a move, committed when made. A large position
        // appends it to the destination column's pieces; the server clamps. On
        // failure the board refetches, which also reconciles the parent's count.
        onMoveSubtask={(id, columnId) =>
          tasksApi
            .moveTask(id, { columnId, position: Number.MAX_SAFE_INTEGER })
            .catch(refresh)
        }
        // Adding or removing a piece changes the parent's count, which the card
        // renders — so the board is stale and refetches.
        onSubtasksChanged={refresh}
        // A blocker added or removed changes the card's blocked-by count, the
        // same staleness for the same reason.
        onDependenciesChanged={refresh}
        // Accepting an agent's changeset applies mutations this board never saw
        // proposed — a held move_task lands a new column_id straight in the DB,
        // bypassing the drag handler that would normally have updated local
        // state on the way. Same staleness, one step further removed.
        onRunReviewed={refresh}
      />
      {/* Every configurable surface, behind one door. The panels are the same
          components they always were — see settingsSections. */}
      <SettingsDialog
        sections={settingsSections}
        section={settingsSection}
        onSectionChange={setSettingsSection}
      />
      <InsightsDialog
        boardId={boardId}
        open={insightsOpen}
        columns={cols}
        membersById={membersById}
        agentsById={agentsById}
        onOpenChange={setInsightsOpen}
      />
      <ScheduleDialog boardId={boardId} open={scheduleOpen} onOpenChange={setScheduleOpen} onApplied={refresh} />
      <TimesheetDialog
        boardId={boardId}
        open={timesheetOpen}
        onOpenChange={setTimesheetOpen}
        currentUserId={currentUserId}
        canReview={canDeleteColumns}
      />
      <CapacityDialog
        boardId={boardId}
        workspaceId={workspaceId}
        open={capacityOpen}
        canManage={canDeleteColumns}
        onOpenChange={setCapacityOpen}
      />
      <BudgetDialog
        boardId={boardId}
        open={budgetOpen}
        canManage={canDeleteColumns}
        onOpenChange={setBudgetOpen}
      />
      <DiscoveryDialog
        boardId={boardId}
        open={discoveryOpen}
        canEdit={canEdit}
        workspaceId={workspaceId}
        canShare={canDeleteColumns}
        onOpenChange={setDiscoveryOpen}
        onPromoted={refresh}
      />
      {canDeleteColumns && (
        <ShareDialog
          open={shareOpen}
          onOpenChange={setShareOpen}
          subjectType="board"
          subjectId={String(boardId)}
          subjectName="this board"
          workspaceId={workspaceId}
        />
      )}
    </ExtensionCatalogProvider>
  );
}
