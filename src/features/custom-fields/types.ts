/**
 * User-defined fields (035): metadata a board defines for itself. A definition
 * (CustomField) is board-scoped; a task's answer is a CustomFieldValue.
 */

export const CUSTOM_FIELD_TYPES = [
  "text",
  "number",
  "date",
  "select",
  "checkbox",
] as const;

export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];

export function isCustomFieldType(value: unknown): value is CustomFieldType {
  return (
    typeof value === "string" &&
    (CUSTOM_FIELD_TYPES as readonly string[]).includes(value)
  );
}

export interface CustomField {
  id: number;
  boardId: number;
  name: string;
  type: CustomFieldType;
  /** The choices for a 'select' field, in order; `[]` for every other kind. */
  options: string[];
  position: number;
  createdAt: string;
}

/** A board's field joined to one task's answer — the shape the task dialog edits.
 *  `value` is TEXT interpreted by `type`, or null when the task has no answer. */
export interface TaskCustomField extends CustomField {
  value: string | null;
}

export interface CreateCustomFieldInput {
  name: string;
  type: CustomFieldType;
  /** Required (non-empty) for 'select', ignored for every other kind. */
  options?: string[];
}

export interface UpdateCustomFieldInput {
  name?: string;
  options?: string[];
  position?: number;
}

/** One answer to set on a task: a value, or null to clear the answer. */
export interface CustomFieldValueInput {
  fieldId: number;
  value: string | null;
}

/** The longest a field name or a select option may be — dropdown-row sized. */
export const CUSTOM_FIELD_NAME_MAX = 40;
