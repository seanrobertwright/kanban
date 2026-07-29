"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft } from "lucide-react";

import { ActivityFeed } from "@/features/activity/components/activity-feed";
import type { Actor } from "@/features/activity/types";
import type { AgentSummary } from "@/features/agents/types";
import { RunReview } from "@/features/agents/components/run-review";
import { AttachmentSection } from "@/features/attachments/components/attachment-section";
import { ChecklistSection } from "@/features/checklists/components/checklist-section";
import { DependencySection } from "@/features/dependencies/components/dependency-section";
import { CommentThread } from "@/features/comments/components/comment-thread";
import { CustomFieldsSection } from "@/features/custom-fields/components/custom-fields-section";
import { TimeSection } from "@/features/time/components/time-section";
import { SlaSection } from "@/features/sla/components/sla-section";
import { DevelopmentSection } from "@/features/git/components/development-section";
import { TaskIntegrationsSection } from "@/features/integrations/components/task-integrations-section";
import { TaskExtensionPanels } from "@/features/extensions/components/task-extension-panels";
import { SubtaskList } from "./subtask-list";
import { LabelPicker } from "@/features/labels/components/label-picker";
import type { Label as LabelData } from "@/features/labels/types";
import type { Milestone } from "@/features/milestones/types";
import type { Epic } from "@/features/epics/types";
import type { Objective } from "@/features/objectives/types";
import type { Sprint } from "@/features/sprints/types";
import type { TaskTemplate } from "@/features/templates/types";
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
import { RichText } from "@/shared/ui/rich-text";
import { CollapsibleSection } from "@/shared/ui/collapsible-section";
import {
  PRIORITY_LABELS,
  PRIORITY_ORDER,
  RECURRENCE_FREQUENCIES,
  RECURRENCE_LABELS,
  TASK_TYPES,
  TASK_TYPE_LABELS,
} from "../types";
import type {
  RecurrenceFrequency,
  Task,
  TaskPriority,
  TaskType,
} from "../types";
import { Select, SelectGroup, SelectItem } from "@/shared/ui/select";

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
  /** Never null: 'task' is the default kind (022), priority's shape. */
  type: TaskType;
  /** Points, or null for unestimated (022). null clears, like dueDate. */
  estimate: number | null;
  /** Business value 0–10 (034), or null for unscored. */
  value: number | null;
  /** Risk 0–10 (034), or null. */
  risk: number | null;
  /** The milestone to aim at (026), or null. null clears, like dueDate. */
  milestoneId: number | null;
  /** The sprint to schedule into (028), or null (backlog). */
  sprintId: number | null;
  /** The epic to file under (031), or null. null clears, like dueDate. */
  epicId: number | null;
  /** The objective to aim at (037), or null. null clears, like dueDate. */
  objectiveId: number | null;
  /** When work begins (032), or null. null clears, dueDate's shape. */
  startDate: string | null;
  /** null clears the date. The input always has a value, so never absent. */
  dueDate: string | null;
  /** Ids, not refs — the form picks from a vocabulary the server already knows. */
  labelIds: number[];
  /** How often the task recurs, or null for a one-off (020). */
  recurrence: RecurrenceFrequency | null;
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

/** A scoring input's DOM string to the API's number-or-null: "" is unscored,
 *  otherwise clamp into the 0–10 the CHECK accepts (034). */
function clampScore(s: string): number | null {
  if (s === "") return null;
  return Math.max(0, Math.min(10, parseInt(s, 10) || 0));
}

/**
 * The live prioritisation score preview — the server's formula (034) mirrored so
 * the reader sees the number update as they type, before saving. Null (shown as
 * "—") until both value and a non-zero estimate exist, exactly as taskColumns'
 * derivation returns null then.
 */
function previewScore(
  valueStr: string,
  estimateStr: string,
  riskStr: string
): number | null {
  const value = clampScore(valueStr);
  const estimate = estimateStr === "" ? null : Math.max(0, parseInt(estimateStr, 10) || 0);
  const risk = clampScore(riskStr) ?? 0;
  if (value === null || estimate === null || estimate === 0) return null;
  return Math.round((value / (estimate * (1 + risk / 10))) * 100) / 100;
}

/**
 * A rail field: a small label over a control, stacked tight.
 *
 * The rail's job is to be readable at a glance and out of the way otherwise,
 * which a twelve-row form of full-size labelled inputs is not. Same Label and
 * same htmlFor as before — the control is unchanged, only its setting is.
 *
 * At module scope, not inside TaskDialog. A component defined in a render body
 * is a new function on every render, so React unmounts and remounts its whole
 * subtree each time — which for a rail of controlled inputs means the field
 * loses focus after every keystroke.
 */
function RailField({
  htmlFor,
  label,
  children,
}: {
  htmlFor?: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1">
      <Label
        htmlFor={htmlFor}
        className="text-xs font-normal text-muted-foreground"
      >
        {label}
      </Label>
      {children}
    </div>
  );
}

/** Every rail select wears the same compact geometry. */
const railSelect = "h-8 w-full py-0 text-sm dark:bg-input/30";

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
  /**
   * The workspace's task templates (019), offered as a starting point when
   * creating a task. Absent/empty renders no picker — so a workspace with no
   * templates, and the edit path (which never instantiates), show the form
   * exactly as before. Instantiation is prefill: choosing one fills these same
   * form fields, and the ordinary create submit does the write.
   */
  templates?: TaskTemplate[];
  /**
   * The board's milestones (026), the picker's options. Absent/empty renders
   * no picker — a board that has never named a checkpoint shows the form
   * exactly as before, the templates rule.
   */
  milestones?: Milestone[];
  /**
   * The board's epics (031), the picker's options. Absent/empty renders no
   * picker — the milestone rule. Hidden for a subtask, which is filed through
   * its parent.
   */
  epics?: Epic[];
  /**
   * The board's objectives (037), the picker's options. Absent/empty renders no
   * picker — the epic rule. Hidden for a subtask, filed through its parent.
   */
  objectives?: Objective[];
  /**
   * The board's sprints (028). The picker offers only planning + active ones
   * to schedule into (a completed sprint's scope is frozen); a task already in
   * a completed sprint still shows it, disabled, so its home is legible.
   * Absent/empty renders no picker — the templates rule.
   */
  sprints?: Sprint[];
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
  /** After a blocker is added or removed — the card's blocked-by count is stale. */
  onDependenciesChanged?: () => void;
  /**
   * After a changeset is accepted or an auto action undone. Unlike the two above,
   * what goes stale here is not a count but the task itself: an accepted
   * `move_task` writes a new column_id, and `revert_action` restores a previous
   * priority/label/due date. The dialog cannot know which — the actions were
   * authored by an agent, not by this form — so it says "something landed" and
   * lets the board refetch.
   */
  onRunReviewed?: () => void;
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
  templates = [],
  milestones = [],
  epics = [],
  objectives = [],
  sprints = [],
  onOpenChange,
  onSubmit,
  onOpenSubtask,
  onBack,
  onMoveSubtask,
  onSubtasksChanged,
  onDependenciesChanged,
  onRunReviewed,
}: TaskDialogProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  // Write/Preview toggle for the description. Preview renders the same safe
  // Markdown subset comments use (033) through RichText, so a person's — or an
  // agent's (M2) — angle brackets are escaped by construction, never HTML.
  const [descPreview, setDescPreview] = useState(false);
  // The encoded picker value: "" | "human:id" | "agent:id". Decoded to an Actor
  // on submit; encoded from the task's Actor on open.
  const [assignee, setAssignee] = useState<string>(UNASSIGNED);
  const [priority, setPriority] = useState<TaskPriority>("none");
  const [type, setType] = useState<TaskType>("task");
  // "" is "unestimated" — the empty <input type="number">, dueDate's shape.
  const [estimate, setEstimate] = useState<string>("");
  // Scoring inputs (034), "" = unscored. Named businessValue, not value, so it
  // does not shadow the `value` loop param the option maps below use.
  const [businessValue, setBusinessValue] = useState<string>("");
  const [risk, setRisk] = useState<string>("");
  // "" is "no milestone" — the <option> stand-in for null (026).
  const [milestoneId, setMilestoneId] = useState<string>("");
  // "" is "backlog" — the <option> stand-in for null (028).
  const [sprintId, setSprintId] = useState<string>("");
  // "" is "no epic" — the <option> stand-in for null (031).
  const [epicId, setEpicId] = useState<string>("");
  // "" is "no objective" — the <option> stand-in for null (037).
  const [objectiveId, setObjectiveId] = useState<string>("");
  // "" is "no start date" — the empty type="date" input, dueDate's shape (032).
  const [startDate, setStartDate] = useState<string>(NO_DUE_DATE);
  const [dueDate, setDueDate] = useState<string>(NO_DUE_DATE);
  const [labelIds, setLabelIds] = useState<number[]>([]);
  // "" is "does not recur" — the <option> value standing in for null, since a DOM
  // value is a string. Decoded to null on submit; encoded from the task on open.
  const [recurrence, setRecurrence] = useState<RecurrenceFrequency | "">("");
  // The template picker's selection (create mode). Controlled and reset on open,
  // so reopening the New-task dialog starts on "Blank task" rather than showing a
  // stale pick over freshly-cleared fields.
  const [templateChoice, setTemplateChoice] = useState<string>("");
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
      setDescPreview(false);
      setAssignee(encodeAssignee(task?.assignee ?? null));
      setPriority(task?.priority ?? "none");
      setType(task?.type ?? "task");
      setEstimate(task?.estimate == null ? "" : String(task.estimate));
      setBusinessValue(task?.value == null ? "" : String(task.value));
      setRisk(task?.risk == null ? "" : String(task.risk));
      setMilestoneId(task?.milestoneId == null ? "" : String(task.milestoneId));
      setSprintId(task?.sprintId == null ? "" : String(task.sprintId));
      setEpicId(task?.epicId == null ? "" : String(task.epicId));
      setObjectiveId(task?.objectiveId == null ? "" : String(task.objectiveId));
      setStartDate(task?.startDate ?? NO_DUE_DATE);
      setDueDate(task?.dueDate ?? NO_DUE_DATE);
      // Back to ids: the task carries {id, name} because the log needs the name
      // (LabelRef), but the form's business is which labels, not what they are
      // called.
      setLabelIds(task?.labels.map((l) => l.id) ?? []);
      setColumnId(task?.columnId ?? 0);
      setTemplateChoice("");
      setRecurrence(task?.recurrence ?? "");
    }
  }, [open, task]);

  /**
   * Instantiate a template into the form. Not a submit and not a server call:
   * it fills the same fields a user types, so they can adjust before creating and
   * the ordinary create path does the one write. Labels come back as ids because
   * that is what the form and the API speak; the template carried names only so a
   * deleted label stayed nameable, which is not this form's concern.
   */
  function applyTemplate(templateId: string) {
    setTemplateChoice(templateId);
    const template = templates.find((t) => String(t.id) === templateId);
    if (!template) return;
    setTitle(template.title);
    setDescription(template.description);
    setPriority(template.priority);
    setLabelIds(template.labels.map((l) => l.id));
  }

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
        // No conversion, priority's twin (022): 'task' is a real kind.
        type,
        // "" is the emptied number input; the API speaks null. parseInt rather
        // than Number so a stray "3.7" degrades to 3 instead of a 400.
        estimate: estimate === "" ? null : Math.max(0, parseInt(estimate, 10) || 0),
        // "" is unscored; otherwise clamp to the 0–10 the API and CHECK accept.
        value: clampScore(businessValue),
        risk: clampScore(risk),
        // "" is the DOM stand-in for "no milestone"; the API speaks null.
        milestoneId: milestoneId === "" ? null : Number(milestoneId),
        // "" is the DOM stand-in for "backlog"; the API speaks null.
        sprintId: sprintId === "" ? null : Number(sprintId),
        // "" is the DOM stand-in for "no epic"; the API speaks null.
        epicId: epicId === "" ? null : Number(epicId),
        // "" is the DOM stand-in for "no objective"; the API speaks null (037).
        objectiveId: objectiveId === "" ? null : Number(objectiveId),
        // "" is the emptied date input; the API speaks null (032), dueDate below.
        startDate: startDate === NO_DUE_DATE ? null : startDate,
        // Converted for assigneeId's reason: "" is what an emptied date input
        // reports, and the API would read it as a malformed date rather than as
        // the clear it is.
        dueDate: dueDate === NO_DUE_DATE ? null : dueDate,
        // No conversion, like priority: [] is the empty set all the way down,
        // which is what keeps this field out of the null-vs-absent problem.
        labelIds,
        // "" is the DOM stand-in for "does not recur"; the API speaks null.
        recurrence: recurrence === "" ? null : recurrence,
      });
    } finally {
      setSaving(false);
    }
  }


  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* A right slide-over, not a centered popup (the design synthesis panel):
          the board stays visible behind the task being edited. Overrides the
          DialogContent centering + zoom with edge-anchoring + a slide.

          Wider than it was, because the shell was never the density problem —
          the single 560px column was. At this width the work (title,
          description, pieces, conversation) gets a column of its own and the
          twelve properties become a rail beside it, which is the difference
          between reading a task and scrolling past a form to reach it. */}
      <DialogContent className="top-0 right-0 left-auto grid h-dvh max-h-dvh w-[min(1040px,96vw)] max-w-none translate-x-0 translate-y-0 grid-rows-[minmax(0,1fr)] gap-0 overflow-hidden rounded-none border-l p-0 sm:max-w-none data-open:zoom-in-100 data-closed:zoom-out-100 data-open:slide-in-from-right-16 data-closed:slide-out-to-right-16">
        <form
          onSubmit={handleSubmit}
          className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto]"
        >
          <DialogHeader className="border-b px-5 py-4 pr-12">
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
          {/* Main column and property rail.

              The main column is the task: what it is called, what it says, the
              pieces it breaks into, and the conversation about it. The rail is
              everything that is *true of* it — assignee, priority, size, dates,
              where it sits in the plan. Those twelve fields were a form you
              scrolled through to reach the comments; beside the work they are a
              summary you read without scrolling at all.

              One column on a phone, where a 20rem rail would leave neither side
              usable. The rail comes second in the DOM so it stacks below the
              title and description there — and so tabbing from the title lands
              in the description rather than in the sprint picker. */}
          <div className="grid min-h-0 grid-cols-1 overflow-hidden md:grid-cols-[minmax(0,1fr)_20rem]">
            <div className="grid min-h-0 auto-rows-min gap-4 overflow-y-auto p-5">
              {/* Create mode only, and only with templates to offer: a starting
                  point, not a control that survives into editing. Choosing one
                  fills the fields below, which the user is then free to change —
                  see applyTemplate. Resetting to the placeholder does nothing, so
                  it is safe to re-pick. */}
              {!task && templates.length > 0 && (
                <div className="grid gap-2">
                  <Label htmlFor="task-template">Start from a template</Label>
                  <Select
                    id="task-template"
                    value={templateChoice}
                    onValueChange={(value) => applyTemplate(value)}
                    className="w-full py-1 text-base md:text-sm dark:bg-input/30"
                  >
                    <SelectItem value="">Blank task</SelectItem>
                    {templates.map((template) => (
                      <SelectItem key={template.id} value={String(template.id)}>
                        {template.title}
                      </SelectItem>
                    ))}
                  </Select>
                </div>
              )}
              <div className="grid gap-2">
                {/* The label is for screen readers only: this input sits at the
                    top of the panel under a heading that already says whether the
                    task is being created or edited, and "Title" over the title is
                    a caption on the obvious. It stays in the DOM because the field
                    still needs a name when it is not being looked at. */}
                <Label htmlFor="task-title" className="sr-only">
                  Title
                </Label>
                <Input
                  id="task-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="What needs doing?"
                  autoFocus
                  className="h-auto border-0 px-0 py-1 text-lg font-medium shadow-none focus-visible:ring-0 md:text-lg dark:bg-transparent"
                />
              </div>
              <div className="grid gap-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="task-description">Description</Label>
                  {/* Write / Preview — the description takes the same safe
                      Markdown subset as comments (**bold**, `code`, - lists,
                      links…), and Preview renders it through RichText (033), which
                      builds React elements, never HTML. */}
                  <div className="flex overflow-hidden rounded-md border border-input text-xs">
                    <button
                      type="button"
                      onClick={() => setDescPreview(false)}
                      aria-pressed={!descPreview}
                      className={`px-2 py-0.5 transition-colors ${
                        descPreview
                          ? "text-muted-foreground hover:bg-muted"
                          : "bg-muted font-medium"
                      }`}
                    >
                      Write
                    </button>
                    <button
                      type="button"
                      onClick={() => setDescPreview(true)}
                      aria-pressed={descPreview}
                      className={`border-l border-input px-2 py-0.5 transition-colors ${
                        descPreview
                          ? "bg-muted font-medium"
                          : "text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      Preview
                    </button>
                  </div>
                </div>
                {descPreview ? (
                  <div className="min-h-[128px] rounded-lg border border-input px-3 py-2">
                    {description.trim() === "" ? (
                      <p className="text-sm text-muted-foreground">
                        Nothing to preview.
                      </p>
                    ) : (
                      <RichText text={description} className="text-sm" />
                    )}
                  </div>
                ) : (
                  <Textarea
                    id="task-description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Optional details — Markdown supported"
                    rows={6}
                  />
                )}
              </div>
              {/* Only an existing task has a thread or history, and only while the
                  dialog is open — mounting either otherwise would fetch on every
                  board render. The keys remount them per task so switching cards
                  cannot show the previous task's entries while the new ones load.

                  What is open and what is folded is a claim about what a reader
                  came for. The pieces, the blockers and the conversation are the
                  task; files, hours, SLA timers, custom answers, linked branches
                  and the audit history are things the task *also* has, and twelve
                  of them stacked open was the density the review objected to.
                  Folded sections still mount and still fetch — see
                  CollapsibleSection — so opening one is instant and its heading
                  can carry a count. */}
              {task && open && (
                <div className="grid gap-4 border-t pt-4">
                  {/* A piece has no pieces of its own — depth is 1 (008) — so the
                      section is here for a top-level task only. It is the sole way
                      to reach a subtask, since none of them are on the board. */}
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
                  {/* Any task — top-level or a piece — can carry a checklist
                      (017), so unlike the subtask list this is not gated on
                      isSubtask. The same refresh the subtasks use: a checklist
                      change moves the card's "2/5" badge, which the board must
                      refetch to show. */}
                  <ChecklistSection
                    key={`checklist-${task.id}`}
                    taskId={task.id}
                    onChanged={onSubtasksChanged}
                  />
                  {/* What this task waits on (018). Open rather than folded: a
                      blocker is the reason work is not moving, which nobody should
                      have to expand a section to discover. Any task can carry
                      dependencies, so it is not gated on isSubtask; a change moves
                      the card's blocked-by count, so it nudges a refetch. */}
                  <DependencySection
                    key={`deps-${task.id}`}
                    taskId={task.id}
                    onChanged={onDependenciesChanged}
                  />
                  {/* An agent run's review sits above the thread: it is what a
                      human came to this task to resolve when the agent has proposed
                      work. Renders nothing when the task has never had a run.
                      Accepting or undoing writes activity, so it bumps the same
                      version the feed reads — the receipt updates in step. It
                      also APPLIES the held mutation, which the feed cannot show
                      and the board cannot guess: an accepted move_task changes
                      the very column the card is sitting in. So it nudges the
                      board too, or the receipt reads "moved to In Progress"
                      above a card that has not moved. */}
                  <RunReview
                    key={`run-${task.id}`}
                    taskId={task.id}
                    onChanged={() => {
                      setActivityVersion((v) => v + 1);
                      onRunReviewed?.();
                    }}
                  />
                  <CommentThread
                    key={`comments-${task.id}`}
                    taskId={task.id}
                    onChanged={() => setActivityVersion((v) => v + 1)}
                  />

                  {/* Files on the task (021). Any task can carry them, so not
                      gated on isSubtask. A change moves the card's paperclip
                      count, so it nudges the same board refresh. */}
                  <CollapsibleSection title="Files">
                    <AttachmentSection
                      key={`attachments-${task.id}`}
                      taskId={task.id}
                      onChanged={onDependenciesChanged}
                    />
                  </CollapsibleSection>
                  {/* The time ledger (027) and the SLA timers (SPEC 1.6) — both
                      about clocks, so one section rather than two. Any task can
                      carry hours: a piece's work is still work. Logging writes
                      history, so it bumps the feed. */}
                  <CollapsibleSection title="Time & SLA">
                    <div className="grid gap-3">
                      <TimeSection
                        key={`time-${task.id}`}
                        taskId={task.id}
                        onChanged={() => setActivityVersion((v) => v + 1)}
                      />
                      <SlaSection key={`sla-${task.id}`} taskId={task.id} />
                    </div>
                  </CollapsibleSection>
                  {/* The board's custom-field answers (035). Inert when the board
                      defines no fields, so this is empty until opted into. No
                      onChanged: custom fields are outside the activity log by
                      design. */}
                  <CollapsibleSection title="Custom fields">
                    <div className="grid gap-3">
                      <CustomFieldsSection
                        key={`fields-${task.id}`}
                        taskId={task.id}
                      />
                      <TaskExtensionPanels
                        key={`field-extensions-${task.id}`}
                        taskId={task.id}
                        slot="custom_field_renderer"
                      />
                    </div>
                  </CollapsibleSection>
                  {/* Linked branches/PRs/commits (2.4/2.5) and the other systems
                      this task touches. Read-only where the git host owns the
                      lifecycle, and inert until something references the task — so
                      it costs nothing on an unlinked one. */}
                  <CollapsibleSection title="Development & integrations">
                    <div className="grid gap-3">
                      <DevelopmentSection
                        key={`dev-${task.id}`}
                        taskId={task.id}
                        taskTitle={task.title}
                      />
                      <TaskIntegrationsSection
                        key={`integrations-${task.id}`}
                        taskId={task.id}
                      />
                      <TaskExtensionPanels
                        key={`extensions-${task.id}`}
                        taskId={task.id}
                      />
                    </div>
                  </CollapsibleSection>
                  {/* The receipt. Folded because it is what you check when
                      something looks wrong, not what you read when you open a
                      task — the conversation above is that. */}
                  <CollapsibleSection title="History">
                    <ActivityFeed
                      key={task.id}
                      taskId={task.id}
                      columnNames={columnNames}
                      memberNames={memberNames}
                      agentNames={agentNames}
                      refreshToken={activityVersion}
                    />
                  </CollapsibleSection>
                </div>
              )}
            </div>

            {/* The property rail. `content-start` so the fields sit at the top
                rather than spreading down a tall panel, and its own scroll so a
                long main column never pushes the labels out of reach. */}
            <aside className="grid auto-rows-min content-start gap-3 overflow-y-auto border-t p-4 md:border-t-0 md:border-l">
              <p className="text-[11px] font-semibold tracking-wider text-muted-foreground/70 uppercase">
                Properties
              </p>
              {/* Status, for a piece only. A top-level task's column is its place
                  on the board and it moves there by drag; a piece has no place on
                  the board (008), so this is the one place its status can be set.
                  The change commits immediately — see onMoveSubtask — because a
                  move is a move whether it happens by drag or by this select.
                  First in the rail because for a piece it is the field that
                  answers "where is this". */}
              {isSubtask && columns.length > 0 && (
                <RailField htmlFor="task-status" label="Status">
                  <Select
                    id="task-status"
                    value={String(columnId)}
                    onValueChange={(value) => {
                      const next = Number(value);
                      setColumnId(next);
                      if (task) onMoveSubtask?.(task.id, next);
                    }}
                    className={railSelect}
                  >
                    {columns.map((column) => (
                      <SelectItem key={column.id} value={String(column.id)}>
                        {column.title}
                      </SelectItem>
                    ))}
                  </Select>
                </RailField>
              )}
              {/* A native select rather than a styled menu: it is one tab stop, it
                  is announced as a listbox without any ARIA of our own, and it gets
                  the platform picker on touch. The second group is 011's agents —
                  the whole wedge, and why the field was labelled "Assignee" rather
                  than anything person-shaped from the start. Each group renders
                  only when it has members, so a workspace with no agents shows
                  exactly the picker it did before. */}
              <RailField htmlFor="task-assignee" label="Assignee">
                <Select
                  id="task-assignee"
                  value={assignee}
                  onValueChange={setAssignee}
                  className={railSelect}
                >
                  <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                  {members.length > 0 && (
                    <SelectGroup label="People">
                      {members.map((member) => (
                        <SelectItem
                          key={member.userId}
                          value={`human:${member.userId}`}
                        >
                          {member.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  )}
                  {agents.length > 0 && (
                    <SelectGroup label="Agents">
                      {agents.map((agent) => (
                        <SelectItem key={agent.id} value={`agent:${agent.id}`}>
                          {agent.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  )}
                </Select>
              </RailField>
              {/* Priority: PRD §9 calls it one of "the fields an agent reasons
                  over when triaging". */}
              <RailField htmlFor="task-priority" label="Priority">
                <Select
                  id="task-priority"
                  value={priority}
                  onValueChange={(value) => setPriority(value as TaskPriority)}
                  className={railSelect}
                >
                  {/* Highest first: the reason to open this menu is almost always
                      to raise a priority, and 'none' is where you already are. The
                      stored order is lowest-first (it is a sort order, and DESC
                      reads better than ASC in a query) — so this reverses a copy
                      rather than reading PRIORITY_ORDER directly, which would
                      silently reorder the enum for everyone. */}
                  {[...PRIORITY_ORDER].reverse().map((value) => (
                    <SelectItem key={value} value={value}>
                      {PRIORITY_LABELS[value]}
                    </SelectItem>
                  ))}
                </Select>
              </RailField>
              {/* Type and estimate (022), paired: what kind of work, and how big —
                  the two facts sprint planning reads together. */}
              <div className="grid grid-cols-2 gap-2">
                <RailField htmlFor="task-type" label="Type">
                  <Select
                    id="task-type"
                    value={type}
                    onValueChange={(value) => setType(value as TaskType)}
                    className={railSelect}
                  >
                    {TASK_TYPES.map((value) => (
                      <SelectItem key={value} value={value}>
                        {TASK_TYPE_LABELS[value]}
                      </SelectItem>
                    ))}
                  </Select>
                </RailField>
                <RailField htmlFor="task-estimate" label="Estimate">
                  {/* type="number" min=0: the API refuses negatives, so the control
                      should not offer them. Clears to "", the unestimated state. */}
                  <Input
                    id="task-estimate"
                    type="number"
                    min={0}
                    step={1}
                    value={estimate}
                    onChange={(e) => setEstimate(e.target.value)}
                    placeholder="Points"
                    className="h-8"
                  />
                </RailField>
              </div>
              {/* Prioritisation scoring (034): value and risk, 0–10, with the live
                  score = value / (estimate × (1 + risk/10)) the board ranks by. The
                  readout mirrors taskColumns' derivation so it updates as you
                  type. */}
              <div className="grid grid-cols-3 gap-2">
                <RailField htmlFor="task-value" label="Value">
                  <Input
                    id="task-value"
                    type="number"
                    min={0}
                    max={10}
                    step={1}
                    value={businessValue}
                    onChange={(e) => setBusinessValue(e.target.value)}
                    placeholder="0–10"
                    className="h-8"
                  />
                </RailField>
                <RailField htmlFor="task-risk" label="Risk">
                  <Input
                    id="task-risk"
                    type="number"
                    min={0}
                    max={10}
                    step={1}
                    value={risk}
                    onChange={(e) => setRisk(e.target.value)}
                    placeholder="0–10"
                    className="h-8"
                  />
                </RailField>
                <RailField label="Score">
                  <p
                    className="flex h-8 items-center justify-center rounded-lg border bg-muted/40 px-2 text-sm font-medium tabular-nums"
                    title="value / (estimate × (1 + risk/10)) — needs value and an estimate"
                  >
                    {previewScore(businessValue, estimate, risk) ?? "—"}
                  </p>
                </RailField>
              </div>
              {/* The work's window, side by side because they are one span — when
                  it begins and when it is due, the two dates the Timeline draws as
                  a bar (032). Either may stand alone: a start with no due, or the
                  reverse. */}
              <div className="grid grid-cols-2 gap-2">
                <RailField htmlFor="task-start-date" label="Start date">
                  {/* type="date", dueDate's reasoning verbatim: its value is already
                      'YYYY-MM-DD', so no parsing and no Date to drag a zoneless date
                      through, and it clears to "" on its own. */}
                  <Input
                    id="task-start-date"
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="h-8"
                  />
                </RailField>
                <RailField htmlFor="task-due-date" label="Due date">
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
                    className="h-8"
                  />
                </RailField>
              </div>
              <div className="grid gap-1">
                <Label className="text-xs font-normal text-muted-foreground">
                  Labels
                </Label>
                <LabelPicker
                  labels={labels}
                  selected={labelIds}
                  onChange={setLabelIds}
                />
              </div>
              {/* Where this sits in the plan. Grouped under a heading and kept
                  last because these are the fields a task is *filed* by rather
                  than worked by — and every one renders only when the board has
                  any (the templates rule), so a board that plans nothing shows
                  nothing here. Hidden for a subtask throughout: a piece is
                  scheduled and filed through its parent. */}
              {!isSubtask &&
                (sprints.length > 0 ||
                  milestones.length > 0 ||
                  epics.length > 0 ||
                  objectives.length > 0) && (
                  <p className="pt-1 text-[11px] font-semibold tracking-wider text-muted-foreground/70 uppercase">
                    Plan
                  </p>
                )}
              {/* Sprint (028). The picker offers planning + active sprints; a
                  completed one shows disabled only if the task is already in it,
                  so its home stays legible. */}
              {!isSubtask && sprints.length > 0 && (
                <RailField htmlFor="task-sprint" label="Sprint">
                  <Select
                    id="task-sprint"
                    value={sprintId}
                    onValueChange={setSprintId}
                    className={railSelect}
                  >
                    <SelectItem value="">Backlog</SelectItem>
                    {sprints
                      .filter(
                        (s) =>
                          s.status !== "completed" || String(s.id) === sprintId
                      )
                      .map((sprint) => (
                        <SelectItem
                          key={sprint.id}
                          value={String(sprint.id)}
                          disabled={sprint.status === "completed"}
                        >
                          {sprint.status === "active"
                            ? `${sprint.name} (active)`
                            : sprint.status === "completed"
                              ? `${sprint.name} (completed)`
                              : sprint.name}
                        </SelectItem>
                      ))}
                  </Select>
                </RailField>
              )}
              {/* Milestone (026). */}
              {!isSubtask && milestones.length > 0 && (
                <RailField htmlFor="task-milestone" label="Milestone">
                  <Select
                    id="task-milestone"
                    value={milestoneId}
                    onValueChange={setMilestoneId}
                    className={railSelect}
                  >
                    <SelectItem value="">No milestone</SelectItem>
                    {milestones.map((milestone) => (
                      <SelectItem
                        key={milestone.id}
                        value={String(milestone.id)}
                      >
                        {milestone.name}
                      </SelectItem>
                    ))}
                  </Select>
                </RailField>
              )}
              {/* Epic (031) — a coarser grouping than a milestone; a task may
                  carry both. */}
              {!isSubtask && epics.length > 0 && (
                <RailField htmlFor="task-epic" label="Epic">
                  <Select
                    id="task-epic"
                    value={epicId}
                    onValueChange={setEpicId}
                    className={railSelect}
                  >
                    <SelectItem value="">No epic</SelectItem>
                    {epics.map((epic) => (
                      <SelectItem key={epic.id} value={String(epic.id)}>
                        {epic.name}
                      </SelectItem>
                    ))}
                  </Select>
                </RailField>
              )}
              {/* Objective (037). A task aims at an outcome the objective's key
                  results measure — independent of any milestone or epic it also
                  carries. */}
              {!isSubtask && objectives.length > 0 && (
                <RailField htmlFor="task-objective" label="Objective">
                  <Select
                    id="task-objective"
                    value={objectiveId}
                    onValueChange={setObjectiveId}
                    className={railSelect}
                  >
                    <SelectItem value="">No objective</SelectItem>
                    {objectives.map((objective) => (
                      <SelectItem
                        key={objective.id}
                        value={String(objective.id)}
                      >
                        {objective.name}
                      </SelectItem>
                    ))}
                  </Select>
                </RailField>
              )}
              {/* Repeat (020). A recurring task spawns its successor when it is
                  moved into the board's done column — so this sets the cadence,
                  and the board's done column is where completion happens. Hidden
                  for a subtask: a piece completes with the parent, not on its own
                  cycle. */}
              {!isSubtask && (
                <RailField htmlFor="task-recurrence" label="Repeat">
                  <Select
                    id="task-recurrence"
                    value={recurrence}
                    onValueChange={(value) =>
                      setRecurrence(value as RecurrenceFrequency | "")
                    }
                    className={railSelect}
                  >
                    <SelectItem value="">Does not repeat</SelectItem>
                    {RECURRENCE_FREQUENCIES.map((value) => (
                      <SelectItem key={value} value={value}>
                        {RECURRENCE_LABELS[value]}
                      </SelectItem>
                    ))}
                  </Select>
                </RailField>
              )}
            </aside>
          </div>
          {/* The footer is the form's third row rather than something floating
              at the popup's padded edge — the panel has no padding of its own
              now, so the default bleed would pull it a rem off the bottom.
              Sitting in the grid also means it stays put while either column
              scrolls, which is what keeps Save reachable from the bottom of a
              long comment thread. */}
          <DialogFooter className="mx-0 mb-0 rounded-none bg-muted/50">
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
