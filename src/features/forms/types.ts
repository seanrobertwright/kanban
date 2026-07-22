/**
 * Forms / intake (039). A Form is a board-scoped, reusable intake definition — a
 * name, a set of questions, and a target column — and submitting one creates a
 * task from the answers. It is the structured-request-capture the feature model
 * calls "intake": an intaker fills shaped questions and the board gains a task,
 * without the intaker having to know the board's columns or fields.
 */

import type { Actor, Condition } from "@/features/automations/types";
import { evaluate, type Snapshot } from "@/features/automations/lib/engine";

/** The kinds of question a form can ask. text is a single line, textarea a
 *  paragraph, number a numeric entry — all captured into the task description. */
export type FormFieldType = "text" | "textarea" | "number";

export const FORM_FIELD_TYPES: readonly FormFieldType[] = [
  "text",
  "textarea",
  "number",
];

/** One question on a form. */
export interface FormField {
  label: string;
  type: FormFieldType;
  /** A required question must be answered before the form submits. */
  required: boolean;
}

export interface Form {
  id: number;
  boardId: number;
  name: string;
  description: string;
  /** Where a submission's task lands, or null → the board's first column. */
  targetColumnId: number | null;
  /** The questions, in order. The first answer becomes the created task's title. */
  fields: FormField[];
  /** A closed form is defined but refuses submissions. */
  isOpen: boolean;
  /** Routing rules (1.7), in order; the first whose conditions match overrides
   *  the target column and sets assignee + labels. Empty = default routing. */
  routing: FormRoute[];
  createdAt: string;
}

/**
 * One routing rule (1.7): if `conditions` hold against the submission's answers
 * (keyed by question label), send the task to `columnId` (when set), assign it,
 * and apply `labelIds`. Reuses the automation engine's Condition tree so a form
 * routes with the same predicate vocabulary a rule fires on.
 */
export interface FormRoute {
  conditions: Condition;
  columnId?: number | null;
  assignee?: Actor | null;
  labelIds?: number[];
}

export interface CreateFormInput {
  name: string;
  description?: string;
  targetColumnId?: number | null;
  fields: FormField[];
  isOpen?: boolean;
  routing?: FormRoute[];
}

export interface UpdateFormInput {
  name?: string;
  description?: string;
  targetColumnId?: number | null;
  fields?: FormField[];
  isOpen?: boolean;
  routing?: FormRoute[];
}

/** A filled-in form: one answer per field, aligned to `fields` by index. */
export interface SubmitFormInput {
  answers: string[];
}

/** Names sit in a dialog row; questions in a compact list — cap both there. */
export const FORM_NAME_MAX = 80;
export const FORM_FIELD_LABEL_MAX = 80;
/** A form with no questions has nothing to capture, and more than this is a
 *  survey, not an intake — bound it so a submission stays a task, not an essay. */
export const FORM_MAX_FIELDS = 20;

export function isFormFieldType(v: unknown): v is FormFieldType {
  return typeof v === "string" && (FORM_FIELD_TYPES as readonly string[]).includes(v);
}

/**
 * Compiles a submission's answers into a task title + description, the one place
 * the intake→task shape is decided so the repository and its test agree. The
 * first field's answer is the title (trimmed); every answered field, the first
 * included, becomes a `**Label:** value` line in the description. Unanswered
 * optional fields are skipped rather than carried as empty rows.
 */
export function compileSubmission(
  fields: FormField[],
  answers: string[]
): { title: string; description: string } {
  const title = (answers[0] ?? "").trim();
  const lines: string[] = [];
  for (let i = 0; i < fields.length; i++) {
    const value = (answers[i] ?? "").trim();
    if (value === "") continue;
    lines.push(`**${fields[i].label}:** ${value}`);
  }
  return { title, description: lines.join("\n\n") };
}

/**
 * Builds the snapshot a routing rule reads: each question's label → its trimmed
 * answer. A numeric question's answer is coerced to a number so numeric operators
 * work. This is the one place the answers→predicate-input shape is decided, so
 * the repository and its test agree.
 */
export function answersSnapshot(
  fields: FormField[],
  answers: string[]
): Snapshot {
  const snap: Snapshot = {};
  for (let i = 0; i < fields.length; i++) {
    const raw = (answers[i] ?? "").trim();
    snap[fields[i].label] =
      fields[i].type === "number" && raw !== "" ? Number(raw) : raw;
  }
  return snap;
}

/**
 * Resolves a submission's routing (1.7): the first route whose conditions hold
 * against the answers snapshot wins, contributing its column/assignee/labels.
 * Returns an empty object when nothing matches, so the caller keeps the form's
 * defaults. Pure — the repository applies the result through createTask.
 */
export function resolveRouting(
  routes: FormRoute[],
  fields: FormField[],
  answers: string[]
): { columnId?: number | null; assignee?: Actor | null; labelIds?: number[] } {
  const snap = answersSnapshot(fields, answers);
  for (const route of routes) {
    if (evaluate(route.conditions, snap)) {
      const out: { columnId?: number | null; assignee?: Actor | null; labelIds?: number[] } = {};
      if ("columnId" in route) out.columnId = route.columnId;
      if ("assignee" in route) out.assignee = route.assignee;
      if (route.labelIds) out.labelIds = route.labelIds;
      return out;
    }
  }
  return {};
}
