/**
 * Automation engine (045) — the spine of Phase 1. An automation rule is a
 * board-scoped trigger→conditions→actions recipe. When the trigger event fires
 * (an activity_log action on the board), the engine evaluates the condition tree
 * against the event's snapshot and, if it holds, applies the actions in order —
 * each through the same repository (and therefore the same authz) a human uses.
 *
 * Eleven of Phase 1's twelve rocks are rule *types or bundles* on this one
 * engine (notification rules, SLAs, routing, recurring actions); the shapes here
 * are the vocabulary they all speak. The pure evaluator/planner lives in
 * `lib/engine.ts` (derive-don't-store: it decides, it never writes); the runner
 * (`server/runner.ts`) applies.
 */

import type { TaskPriority, TaskType } from "@/features/tasks/types";
import type { Actor } from "@/features/activity/types";

export type { Actor };

/**
 * The events a rule may subscribe to. Deliberately a subset of the task
 * ActivityAction union (activity/types.ts): those are the mutations the engine
 * can meaningfully react to, each carrying a TaskSnapshot in the activity row's
 * `after` for conditions to read. schedule.tick (1.4) and external.trigger
 * (1.12) join this list when those rocks land; the engine already dispatches by
 * string, so widening it is a one-line change here plus a producer.
 */
export const TRIGGER_EVENTS = [
  "task.created",
  "task.moved",
  "task.updated",
  "task.assigned",
  "task.prioritized",
  "task.scheduled",
  "task.labeled",
  // Synthetic, not an activity_log action: the scheduler emits it on a timer
  // (1.4). A schedule.tick rule scans the board's tasks each tick and applies its
  // actions to the ones its conditions match, rather than reacting to one event.
  "schedule.tick",
  // Synthetic, raised by an external tool POSTing a board's trigger token (1.12).
  // Like schedule.tick it scans the board — the difference is what wakes it.
  "external.trigger",
] as const;

export type TriggerEvent = (typeof TRIGGER_EVENTS)[number];

/** How often a schedule.tick rule fires (1.4). */
export const SCHEDULE_INTERVALS = ["hourly", "daily", "weekly"] as const;
export type ScheduleInterval = (typeof SCHEDULE_INTERVALS)[number];

export interface Trigger {
  event: TriggerEvent;
  /** Only for schedule.tick — the recurrence cadence. */
  every?: ScheduleInterval;
}

export function isScheduleInterval(v: unknown): v is ScheduleInterval {
  return typeof v === "string" && (SCHEDULE_INTERVALS as readonly string[]).includes(v);
}

/**
 * The predicate tree — 1.2 "conditional branching" in data form. A condition is
 * either a boolean group (all / any / not) or a leaf comparison, so an author
 * composes arbitrary AND/OR/NOT logic. The empty tree `{}` is always-true: a
 * rule with no conditions fires on every occurrence of its trigger.
 */
export type Condition =
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }
  | Predicate;

/** A leaf: compare one snapshot field against a value with an operator. */
export interface Predicate {
  /** A TaskSnapshot key; dotted for nested actors, e.g. "assignee.id". */
  field: string;
  op: Operator;
  /** Absent for the unary operators (isSet / isEmpty). */
  value?: unknown;
}

/**
 * The comparison operators. Kept small and total — every one is defined for a
 * missing field (a null/undefined snapshot value) rather than throwing, because
 * a rule must never crash the mutation that triggered it. `contains` is
 * substring on a string and membership on an array (so it reads a task's label
 * set); `in` is the mirror (field ∈ a caller-supplied array).
 */
export const OPERATORS = [
  "eq",
  "neq",
  "lt",
  "lte",
  "gt",
  "gte",
  "contains",
  "in",
  "isSet",
  "isEmpty",
] as const;

export type Operator = (typeof OPERATORS)[number];

/**
 * The actions a rule can take. Each maps to an existing repository call in the
 * runner, so the engine's blast radius is exactly a member's — nothing an
 * automation does is a door a human lacks.
 *
 * `onlyIf` is 1.2's per-action branch: an action carrying it is applied only
 * when its own sub-condition holds against the snapshot, so one rule can do
 * different things to different tasks ("Then: if priority=urgent notify, else
 * just label"). Evaluated by planActions, which drops the actions that fail.
 */
export type Action =
  | ({ type: "move"; columnId: number } & ActionBase)
  | ({ type: "assign"; assignee: Actor | null } & ActionBase)
  | ({ type: "set_field"; field: SettableField; value: SettableValue } & ActionBase)
  | ({ type: "add_label"; labelId: number } & ActionBase)
  | ({ type: "comment"; body: string } & ActionBase)
  | ({ type: "notify"; target: NotifyTarget; message?: string } & ActionBase);

/**
 * Who a notify action pings (1.5). "assignee" resolves to the task's current
 * human assignee at fire time; an explicit human target names a member. The
 * bell has no notification table — it derives from the activity log + comment
 * mentions (016/024) — so a notify posts a comment that @-mentions the target,
 * which is exactly the "mentioned you on" the bell already surfaces.
 */
export type NotifyTarget = "assignee" | { type: "human"; id: string };

interface ActionBase {
  onlyIf?: Condition;
}

/**
 * The task fields a `set_field` action may write. A strict subset of
 * UpdateTaskInput's keys — the ones whose value is a scalar an author can name
 * in a builder — routed through updateTask so tenancy checks (a milestone on
 * *this* board) still run.
 */
export const SETTABLE_FIELDS = [
  "priority",
  "type",
  "estimate",
  "dueDate",
  "startDate",
  "milestoneId",
  "sprintId",
  "epicId",
  "objectiveId",
  "value",
  "risk",
] as const;

export type SettableField = (typeof SETTABLE_FIELDS)[number];
export type SettableValue = string | number | null;

/**
 * A rule as stored. trigger/conditions/actions are the validated JSONB shapes
 * above; created_by is the principal the engine acts as (see the migration).
 */
export interface AutomationRule {
  id: number;
  boardId: number;
  name: string;
  isEnabled: boolean;
  trigger: Trigger;
  conditions: Condition;
  actions: Action[];
  createdBy: string;
  createdAt: string;
}

export interface CreateAutomationRuleInput {
  name: string;
  trigger: Trigger;
  conditions?: Condition;
  actions?: Action[];
  isEnabled?: boolean;
}

export interface UpdateAutomationRuleInput {
  name?: string;
  trigger?: Trigger;
  conditions?: Condition;
  actions?: Action[];
  isEnabled?: boolean;
}

/**
 * State transition rules (046, rock 1.3) — the board's allowed-transition map,
 * consulted by moveTask. `allowed` whitelists the columns a task may move *to*
 * from a given column (a from-column absent from the map is unconstrained);
 * `guards` attaches a condition to an edge that must hold to cross it, reusing
 * the same evaluator rules fire on. Edge keys are "fromColumnId>toColumnId".
 */
export interface BoardWorkflow {
  allowed: Record<string, number[]>;
  guards?: Record<string, Condition>;
}

/** The edge key moveTask and the matrix editor agree on. */
export function edgeKey(from: number, to: number): string {
  return `${from}>${to}`;
}

/** A minted inbound trigger token (1.12). The token itself is only returned
 *  from create — thereafter the list shows a masked tail. */
export interface AutomationTrigger {
  id: number;
  boardId: number;
  name: string;
  token: string;
  isActive: boolean;
  createdAt: string;
}

/**
 * Workflow templates (051, rock 1.9) — a reusable bundle of columns + rules + SLA
 * policies, applied to a board in one move. The rule/SLA shapes mirror the create
 * inputs the respective repositories validate on apply.
 */
export interface WorkflowTemplateRule {
  name: string;
  trigger: Trigger;
  conditions?: Condition;
  actions?: Action[];
}

export interface WorkflowTemplateSla {
  name: string;
  appliesWhen?: Condition;
  targetMins: number;
  actionOnBreach?: Action[];
}

export interface WorkflowTemplateBody {
  columns: string[];
  rules: WorkflowTemplateRule[];
  slaPolicies: WorkflowTemplateSla[];
}

export interface WorkflowTemplate extends WorkflowTemplateBody {
  /** Numeric id for a saved template; a "builtin:<key>" string for a code preset. */
  id: number | string;
  name: string;
  description: string;
  isBuiltin: boolean;
}

export interface CreateWorkflowTemplateInput {
  name: string;
  description?: string;
  columns?: string[];
  rules?: WorkflowTemplateRule[];
  slaPolicies?: WorkflowTemplateSla[];
}

export type AutomationRunStatus = "matched" | "skipped" | "error" | "capped";

/** One logged fire — the audit arm, read by the run-log tab (1.1). */
export interface AutomationRun {
  id: string;
  ruleId: number;
  activityId: string;
  status: AutomationRunStatus;
  detail: unknown;
  createdAt: string;
}

/** Names sit in a dialog row; cap them there. */
export const AUTOMATION_NAME_MAX = 80;
/** A rule with more actions than this is a script, not a recipe (see 1.11). */
export const AUTOMATION_MAX_ACTIONS = 20;
/** Guards against a pathological hand-authored predicate tree. */
export const AUTOMATION_MAX_CONDITION_DEPTH = 10;

export function isTriggerEvent(v: unknown): v is TriggerEvent {
  return typeof v === "string" && (TRIGGER_EVENTS as readonly string[]).includes(v);
}

export function isOperator(v: unknown): v is Operator {
  return typeof v === "string" && (OPERATORS as readonly string[]).includes(v);
}

export function isSettableField(v: unknown): v is SettableField {
  return typeof v === "string" && (SETTABLE_FIELDS as readonly string[]).includes(v);
}

/** Re-exported so callers building set_field actions get the value union. */
export type { TaskPriority, TaskType };
