import {
  formatCustomFieldValue,
  type CustomField,
} from "@/features/custom-fields/types";
import type { Task } from "@/features/tasks/types";

/**
 * One custom field's answer, as a schedule lens shows it (the 035 follow-up).
 *
 * Cards and the list have shown custom-field answers since 036; the Timeline and
 * the Gantt never read them, so the two lenses where you plan *by* an attribute —
 * which client, which environment, which team — were the two that could not show
 * it. This is the shared half of the fix: the lenses differ in how they draw a
 * bar and not at all in what the annotation says.
 *
 * ONE field at a time, chosen by the viewer, rather than every answer on every
 * bar. A schedule row is mostly track: the label shares its line with the bar,
 * and a task with six custom fields would push its own dates off screen. The
 * list view is where you read every answer at once — it has a column per field
 * precisely because it can afford them.
 */
export function fieldAnnotation(
  task: Pick<Task, "customFields">,
  field: CustomField | undefined
): string | null {
  if (!field) return null;
  const answer = task.customFields.find((v) => v.fieldId === field.id);
  // An unanswered field annotates nothing. Rendering "Client: —" on every
  // unanswered bar would spend the row's scarcest space saying that a question
  // was not answered, which is the least useful thing a schedule can tell you.
  if (!answer || answer.value === "") return null;
  return formatCustomFieldValue(field, answer.value);
}

/** The board's fields in the order the pickers offer them — display position,
 *  id breaking ties, matching the list view's column order so a viewer meets
 *  the same sequence in both places. */
export function annotatableFields(
  customFieldsById: Record<number, CustomField> | undefined
): CustomField[] {
  return Object.values(customFieldsById ?? {}).sort(
    (a, b) => a.position - b.position || a.id - b.id
  );
}
