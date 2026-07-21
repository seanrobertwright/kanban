"use client";

import { useEffect, useState } from "react";

import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import * as api from "../client/api";
import {
  CUSTOM_FIELD_TYPES,
  type CustomField,
  type CustomFieldType,
} from "../types";

interface CustomFieldsDialogProps {
  boardId: number;
  open: boolean;
  canEdit: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * A definition changed (035 → 036 follow-up): values now show on cards and in
   * list columns, so the board must re-read its custom_field list when a field
   * is added or deleted. The milestones dialog's onChanged, one feature on.
   */
  onChanged?: () => void;
}

const SELECT_CLASS =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30";

const TYPE_LABELS: Record<CustomFieldType, string> = {
  text: "Text",
  number: "Number",
  date: "Date",
  select: "Select",
  checkbox: "Checkbox",
};

/**
 * The board's custom-field definitions (035) — the manager for what metadata a
 * board tracks. Self-fetching (load-on-open), member-gated: defining a board's
 * shape is a board mutation. Deleting a field clears its values everywhere, so
 * the delete is two-click, the confirm the rest of the app uses in place of a
 * blocking modal.
 */
export function CustomFieldsDialog({
  boardId,
  open,
  canEdit,
  onOpenChange,
  onChanged,
}: CustomFieldsDialogProps) {
  const [fields, setFields] = useState<CustomField[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const [confirmingId, setConfirmingId] = useState<number | null>(null);

  const [name, setName] = useState("");
  const [type, setType] = useState<CustomFieldType>("text");
  const [optionsText, setOptionsText] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await api.fetchBoardFields(boardId);
        if (!cancelled) setFields(data);
      } catch (e) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "Failed to load fields");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, boardId, version]);

  async function mutate(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      setVersion((v) => v + 1);
      // The board's copy of the definitions is now stale — its cards and list
      // columns read them. Re-read the whole board, the milestones dialog's path.
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    const trimmed = name.trim();
    if (!trimmed) return;
    // Options are a comma-separated list, meaningful only for a select.
    const options =
      type === "select"
        ? optionsText.split(",").map((o) => o.trim()).filter(Boolean)
        : undefined;
    await mutate(async () => {
      await api.createField(boardId, { name: trimmed, type, options });
      setName("");
      setOptionsText("");
      setType("text");
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Custom fields</DialogTitle>
          <DialogDescription>
            Metadata this board tracks on every task. Deleting a field clears its
            values everywhere.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        {fields.length > 0 ? (
          <ul className="grid gap-1.5">
            {fields.map((field) => (
              <li
                key={field.id}
                className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm"
              >
                <span className="min-w-0 truncate">
                  <span className="font-medium">{field.name}</span>{" "}
                  <span className="text-xs text-muted-foreground">
                    {TYPE_LABELS[field.type]}
                    {field.type === "select" &&
                      field.options.length > 0 &&
                      ` · ${field.options.join(", ")}`}
                  </span>
                </span>
                {canEdit && (
                  <button
                    type="button"
                    className="shrink-0 text-xs text-muted-foreground hover:text-destructive"
                    disabled={busy}
                    onClick={() =>
                      confirmingId === field.id
                        ? mutate(() => api.deleteField(field.id))
                        : setConfirmingId(field.id)
                    }
                    onBlur={() => setConfirmingId(null)}
                  >
                    {confirmingId === field.id ? "Really?" : "Delete"}
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No custom fields yet.</p>
        )}

        {canEdit && (
          <div className="grid gap-2 border-t pt-3">
            <div className="grid gap-1">
              <Label htmlFor="cf-name">New field</Label>
              <Input
                id="cf-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Field name"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <select
                aria-label="Field type"
                className={SELECT_CLASS}
                value={type}
                onChange={(e) => setType(e.target.value as CustomFieldType)}
              >
                {CUSTOM_FIELD_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
              {type === "select" && (
                <Input
                  aria-label="Options, comma separated"
                  value={optionsText}
                  onChange={(e) => setOptionsText(e.target.value)}
                  placeholder="Low, Medium, High"
                />
              )}
            </div>
            <div className="flex justify-end">
              <Button
                type="button"
                size="sm"
                disabled={busy || !name.trim()}
                onClick={create}
              >
                Add field
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
