"use client";

import { useCallback, useMemo, useState } from "react";
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
  Clock,
  Columns3,
  Download,
  Flag,
  GanttChartSquare,
  Inbox,
  Layers,
  LayoutTemplate,
  List,
  Map as MapIcon,
  Plus,
  Rocket,
  SlidersHorizontal,
  Tags,
  Target,
  Waypoints,
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
import type { Member } from "@/features/workspaces/types";
import { Button } from "@/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { Input } from "@/shared/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/shared/ui/toggle-group";
import * as boardApi from "../client/api";
import { fetchBoard } from "../client/api";
import type { Column } from "../types";
import { BoardColumn } from "./board-column";
import { InsightsDialog } from "./insights-dialog";
import { TimesheetDialog } from "@/features/time/components/timesheet-dialog";
import { CustomFieldsDialog } from "@/features/custom-fields/components/custom-fields-dialog";
import type { CustomField } from "@/features/custom-fields/types";
import { MilestonesDialog } from "@/features/milestones/components/milestones-dialog";
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
import { GanttView } from "./gantt-view";
import { TimelineView } from "./timeline-view";
import { RoadmapView } from "./roadmap-view";
import { ListView } from "./list-view";
import { SavedViews } from "@/features/views/components/saved-views";
import type { BoardViewMode, SavedView } from "@/features/views/types";
import { TemplatesDialog } from "@/features/templates/components/templates-dialog";
import type { TaskTemplate } from "@/features/templates/types";

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
  /** False for viewers. The server enforces this too — this only hides the UI. */
  canEdit: boolean;
  /**
   * Admin and up. Only deletion needs the extra rank: creating and renaming are
   * cheap and reversible, deleting can destroy work (§7.4's blast-radius rule,
   * applied to people). The server enforces both — these only hide the UI.
   */
  canDeleteColumns: boolean;
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
  canEdit,
  canDeleteColumns,
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
  const [labelsOpen, setLabelsOpen] = useState(false);
  const [templates, setTemplates] = useState<TaskTemplate[]>(initialTemplates);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [insightsOpen, setInsightsOpen] = useState(false);
  const [timesheetOpen, setTimesheetOpen] = useState(false);
  const [milestones, setMilestones] = useState<Milestone[]>(initialMilestones);
  const [milestonesOpen, setMilestonesOpen] = useState(false);
  const [epics, setEpics] = useState<Epic[]>(initialEpics);
  const [epicsOpen, setEpicsOpen] = useState(false);
  const [objectives, setObjectives] =
    useState<Objective[]>(initialObjectives);
  const [objectivesOpen, setObjectivesOpen] = useState(false);
  const [sprints, setSprints] = useState<Sprint[]>(initialSprints);
  const [sprintsOpen, setSprintsOpen] = useState(false);
  const [dependencies, setDependencies] =
    useState<TaskDependencyEdge[]>(initialDependencies);
  const [customFields, setCustomFields] =
    useState<CustomField[]>(initialCustomFields);
  const customFieldsById = useMemo(
    () => Object.fromEntries(customFields.map((f) => [f.id, f])),
    [customFields]
  );
  const [fieldsOpen, setFieldsOpen] = useState(false);
  const [doneColumnId, setDoneColumnId] = useState<number | null>(
    initialDoneColumnId
  );
  const labelsById = useMemo(
    () => Object.fromEntries(labels.map((l) => [l.id, l])),
    [labels]
  );
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

  return (
    <>
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
          <ToggleGroup
            value={[view]}
            onValueChange={(v) => {
              // Single-select, but base-ui hands back an array; ignore the empty
              // case so clicking the active lens does not deselect into nothing.
              if (v[0]) setView(v[0] as BoardViewMode);
            }}
          >
            <ToggleGroupItem value="board">
              <Columns3 /> Board
            </ToggleGroupItem>
            <ToggleGroupItem value="list">
              <List /> List
            </ToggleGroupItem>
            <ToggleGroupItem value="calendar">
              <CalendarDays /> Calendar
            </ToggleGroupItem>
            <ToggleGroupItem value="timeline">
              <GanttChartSquare /> Timeline
            </ToggleGroupItem>
            <ToggleGroupItem value="gantt">
              <Waypoints /> Gantt
            </ToggleGroupItem>
            <ToggleGroupItem value="backlog">
              <Inbox /> Backlog
            </ToggleGroupItem>
            <ToggleGroupItem value="roadmap">
              <MapIcon /> Roadmap
            </ToggleGroupItem>
          </ToggleGroup>
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={() => setTemplatesOpen(true)}
          >
            <LayoutTemplate /> Templates
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={() => setLabelsOpen(true)}
          >
            <Tags /> Labels
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={() => setSprintsOpen(true)}
          >
            <Rocket /> Sprints
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={() => setMilestonesOpen(true)}
          >
            <Flag /> Milestones
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={() => setEpicsOpen(true)}
          >
            <Layers /> Epics
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={() => setObjectivesOpen(true)}
          >
            <Target /> Objectives
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={() => setFieldsOpen(true)}
          >
            <SlidersHorizontal /> Fields
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={() => setInsightsOpen(true)}
          >
            <ChartNoAxesColumn /> Insights
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={() => setTimesheetOpen(true)}
          >
            <Clock /> Timesheet
          </Button>
          {/* Export is a GET the browser can follow — plain anchors, so the
              download rides the session cookie with no fetch-and-blob dance.
              Viewer+: an export is a read of what the board already shows. */}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground"
                >
                  <Download /> Export
                </Button>
              }
            />
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                render={<a href={`/api/board/${boardId}/export?format=csv`}>CSV</a>}
              />
              <DropdownMenuItem
                render={
                  <a href={`/api/board/${boardId}/export?format=json`}>JSON</a>
                }
              />
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
          onOpenMilestones={() => setMilestonesOpen(true)}
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
      />
      {/* Beside the labels dialog and sharing its vocabulary: a template picks
          labels from the same set (019). canEdit gates all of create/edit/delete
          — a template deletion has no task-side blast radius, so it needs member,
          not the admin canDeleteColumns demands. */}
      <SprintsDialog
        boardId={boardId}
        open={sprintsOpen}
        canEdit={canEdit}
        membersById={membersById}
        agentsById={agentsById}
        onOpenChange={setSprintsOpen}
        onChanged={refresh}
      />
      <MilestonesDialog
        boardId={boardId}
        open={milestonesOpen}
        milestones={milestones}
        epics={epics}
        objectives={objectives}
        canEdit={canEdit}
        onOpenChange={setMilestonesOpen}
        onChanged={refresh}
      />
      <EpicsDialog
        boardId={boardId}
        open={epicsOpen}
        epics={epics}
        canEdit={canEdit}
        onOpenChange={setEpicsOpen}
        onChanged={refresh}
      />
      <ObjectivesDialog
        boardId={boardId}
        open={objectivesOpen}
        objectives={objectives}
        canEdit={canEdit}
        onOpenChange={setObjectivesOpen}
        onChanged={refresh}
      />
      <CustomFieldsDialog
        boardId={boardId}
        open={fieldsOpen}
        canEdit={canEdit}
        onOpenChange={setFieldsOpen}
        onChanged={refresh}
      />
      <InsightsDialog
        boardId={boardId}
        open={insightsOpen}
        columns={cols}
        membersById={membersById}
        agentsById={agentsById}
        onOpenChange={setInsightsOpen}
      />
      <TimesheetDialog
        boardId={boardId}
        open={timesheetOpen}
        onOpenChange={setTimesheetOpen}
      />
      <TemplatesDialog
        open={templatesOpen}
        workspaceId={workspaceId}
        templates={templates}
        labels={labels}
        canEdit={canEdit}
        onOpenChange={setTemplatesOpen}
        onChanged={setTemplates}
      />
      <LabelsDialog
        open={labelsOpen}
        workspaceId={workspaceId}
        labels={labels}
        canEdit={canEdit}
        canDelete={canDeleteColumns}
        onOpenChange={setLabelsOpen}
        onChanged={(next) => {
          setLabels(next);
          // The vocabulary changed, so the tasks may have too: deleting a label
          // unlabels every task wearing it, and a rename changes what their
          // chips say. Both are server-side facts this board is now stale about.
          void refresh();
        }}
      />
    </>
  );
}
