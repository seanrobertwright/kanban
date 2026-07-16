"use client";

import { Button } from "@/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { LabelChip, labelDotClass } from "./label-chip";
import type { Label } from "../types";

interface LabelPickerProps {
  /** The workspace's vocabulary — the only labels that may be chosen. */
  labels: Label[];
  selected: number[];
  onChange: (labelIds: number[]) => void;
  disabled?: boolean;
}

/**
 * Choosing from a vocabulary, never typing into one.
 *
 * There is deliberately no "create a label" field here, and that is the whole
 * design rather than an omission. The moment a task dialog can mint a label,
 * every hurried edit adds one, and the controlled set 007 built — the thing that
 * keeps `bug` from becoming bug/Bug/BUG, and that lets an agent choose rather
 * than invent — becomes a suggestion. Labels are managed where the vocabulary
 * lives, in the board header. This picks from it.
 */
export function LabelPicker({
  labels,
  selected,
  onChange,
  disabled,
}: LabelPickerProps) {
  const chosen = new Set(selected);
  // The vocabulary's order, filtered — not the selection's order. A picker whose
  // rows move as you tick them is a picker you cannot use.
  const selectedLabels = labels.filter((l) => chosen.has(l.id));

  function toggle(id: number) {
    const next = new Set(chosen);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange([...next]);
  }

  return (
    <div className="grid gap-1.5">
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={disabled || labels.length === 0}
          render={
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 justify-start font-normal text-muted-foreground"
            >
              {labels.length === 0
                ? "No labels in this workspace yet"
                : selectedLabels.length === 0
                  ? "Add labels"
                  : `${selectedLabels.length} selected`}
            </Button>
          }
        />
        <DropdownMenuContent align="start" className="max-h-64 overflow-y-auto">
          {labels.map((label) => (
            // A CheckboxItem rather than an Item with a tick drawn in it: this
            // is a multi-select, and the primitive is what makes a screen reader
            // announce "checked" rather than describe a decorative glyph. It also
            // defaults to staying open on click, which an Item does not — and a
            // menu that closes on every tick turns choosing three labels into
            // three trips.
            <DropdownMenuCheckboxItem
              key={label.id}
              checked={chosen.has(label.id)}
              onCheckedChange={() => toggle(label.id)}
            >
              <span
                className={`size-2 shrink-0 rounded-full ${labelDotClass(label.color)}`}
                aria-hidden="true"
              />
              <span className="flex-1 truncate">{label.name}</span>
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {selectedLabels.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selectedLabels.map((label) => (
            <LabelChip key={label.id} name={label.name} color={label.color} />
          ))}
        </div>
      )}
    </div>
  );
}
