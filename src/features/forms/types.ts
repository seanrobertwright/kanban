/**
 * Forms / intake (039). A Form is a board-scoped, reusable intake definition — a
 * name, a set of questions, and a target column — and submitting one creates a
 * task from the answers. It is the structured-request-capture the feature model
 * calls "intake": an intaker fills shaped questions and the board gains a task,
 * without the intaker having to know the board's columns or fields.
 */

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
  createdAt: string;
}

export interface CreateFormInput {
  name: string;
  description?: string;
  targetColumnId?: number | null;
  fields: FormField[];
  isOpen?: boolean;
}

export interface UpdateFormInput {
  name?: string;
  description?: string;
  targetColumnId?: number | null;
  fields?: FormField[];
  isOpen?: boolean;
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
