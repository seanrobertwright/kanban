"use client";

import type { CustomField } from "@/features/custom-fields/types";
import { Select, SelectItem } from "@/shared/ui/select";

/**
 * "Annotate bars with —" for the schedule lenses.
 *
 * Shared by the Timeline and the Gantt rather than written twice: the two lenses
 * disagree about how to draw a bar and agree completely about this control, and
 * two copies of a picker are two chances for the label, the ordering or the
 * "None" sentinel to drift apart.
 *
 * The choice is per-lens component state, deliberately not saved: it is a
 * reading aid for the question in front of you ("which of these are the
 * Acme ones?"), not a property of the view. Persisting it into saved views
 * (037's `view_mode` payload) is a bigger change than this follow-up, and
 * guessing that someone wants last week's annotation back is worse than
 * re-picking it.
 */
export function FieldAnnotationPicker({
  fields,
  value,
  onChange,
}: {
  fields: CustomField[];
  /** The chosen field's id, or null for "no annotation". */
  value: number | null;
  onChange: (fieldId: number | null) => void;
}) {
  // No fields on this board means no question to ask. The control hides rather
  // than offering a picker whose only option is "None".
  if (fields.length === 0) return null;

  return (
    <label className="flex items-center gap-1.5 text-meta text-muted-foreground">
      Annotate
      <Select
        value={String(value ?? 0)}
        onValueChange={(next) => onChange(Number(next) || null)}
        aria-label="Annotate bars with a custom field"
      >
        <SelectItem value="0">None</SelectItem>
        {fields.map((field) => (
          <SelectItem key={field.id} value={String(field.id)}>
            {field.name}
          </SelectItem>
        ))}
      </Select>
    </label>
  );
}
