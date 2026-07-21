"use client";

import { useEffect, useState } from "react";

import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import * as api from "../client/api";
import type { TaskCustomField } from "../types";

interface CustomFieldsSectionProps {
  taskId: number;
}

const SELECT_CLASS =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30";

/**
 * The task's answers to its board's custom fields (035) — a dialog section in the
 * TimeSection shape: self-fetching, keyed by task, saving each answer on its own
 * as it changes rather than on the task form's submit. Renders nothing when the
 * board defines no fields, so a board that never opts in never sees this.
 *
 * Each answer persists on commit (blur for typed inputs, change for select and
 * checkbox) via a PUT of that one value — the server validates it against the
 * field's type, so a "must be a number" surfaces here where it was typed.
 */
export function CustomFieldsSection({ taskId }: CustomFieldsSectionProps) {
  const [fields, setFields] = useState<TaskCustomField[]>([]);
  const [draft, setDraft] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api.fetchTaskFields(taskId);
        if (cancelled) return;
        setFields(data);
        setDraft(
          Object.fromEntries(data.map((f) => [f.id, f.value ?? ""]))
        );
      } catch (e) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "Failed to load fields");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [taskId]);

  async function commit(fieldId: number, value: string) {
    setError(null);
    try {
      const updated = await api.setTaskFields(taskId, [
        { fieldId, value: value === "" ? null : value },
      ]);
      // Adopt the server's stored values — it may have trimmed or cleared one.
      setFields(updated);
      setDraft(Object.fromEntries(updated.map((f) => [f.id, f.value ?? ""])));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the field");
    }
  }

  if (fields.length === 0) return null;

  return (
    <div className="grid gap-2">
      <p className="text-xs font-medium text-muted-foreground">Fields</p>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="grid gap-2">
        {fields.map((field) => {
          const value = draft[field.id] ?? "";
          const set = (v: string) =>
            setDraft((d) => ({ ...d, [field.id]: v }));
          const inputId = `cf-${field.id}`;

          if (field.type === "checkbox") {
            return (
              <label
                key={field.id}
                className="flex items-center gap-2 text-sm"
                htmlFor={inputId}
              >
                <input
                  id={inputId}
                  type="checkbox"
                  checked={value === "true"}
                  onChange={(e) => {
                    const v = e.target.checked ? "true" : "false";
                    set(v);
                    void commit(field.id, v);
                  }}
                />
                {field.name}
              </label>
            );
          }

          return (
            <div key={field.id} className="grid gap-1">
              <Label htmlFor={inputId}>{field.name}</Label>
              {field.type === "select" ? (
                <select
                  id={inputId}
                  className={SELECT_CLASS}
                  value={value}
                  onChange={(e) => {
                    set(e.target.value);
                    void commit(field.id, e.target.value);
                  }}
                >
                  <option value="">—</option>
                  {field.options.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              ) : (
                <Input
                  id={inputId}
                  type={
                    field.type === "number"
                      ? "number"
                      : field.type === "date"
                        ? "date"
                        : "text"
                  }
                  value={value}
                  onChange={(e) => set(e.target.value)}
                  // Persist when the field loses focus — one PUT per answer, the
                  // server validates the value against the field's type.
                  onBlur={() => {
                    if ((fields.find((f) => f.id === field.id)?.value ?? "") !== value) {
                      void commit(field.id, value);
                    }
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
