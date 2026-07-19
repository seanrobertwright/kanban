"use client";

import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";

import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import * as api from "../client/api";
import { CHECKLIST_CONTENT_MAX, type ChecklistItem } from "../types";

interface ChecklistSectionProps {
  taskId: number;
  /** After any change — the parent card's "2/5" badge is now stale. */
  onChanged?: () => void;
}

/**
 * A task's checklist, self-contained: it fetches its own items when mounted (the
 * dialog mounts it only for an existing, open task), and every mutation is
 * optimistic with a refetch on failure — the board's own pattern, one level
 * down. Adding, toggling, or removing an item nudges `onChanged` so the card's
 * progress badge refreshes.
 */
export function ChecklistSection({ taskId, onChanged }: ChecklistSectionProps) {
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const next = await api.fetchChecklist(taskId);
        if (active) setItems(next);
      } catch {
        // Leave the list empty if it cannot be read; the next open retries.
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [taskId]);

  async function reload() {
    try {
      setItems(await api.fetchChecklist(taskId));
    } catch {
      // keep optimistic state
    }
  }

  async function add() {
    const content = draft.trim();
    if (!content || busy) return;
    setBusy(true);
    try {
      const created = await api.createChecklistItem(taskId, { content });
      setItems((prev) => [...prev, created]);
      setDraft("");
      onChanged?.();
    } catch {
      void reload();
    } finally {
      setBusy(false);
    }
  }

  function toggle(item: ChecklistItem) {
    const done = !item.done;
    setItems((prev) =>
      prev.map((i) => (i.id === item.id ? { ...i, done } : i))
    );
    api
      .updateChecklistItem(item.id, { done })
      .then(() => onChanged?.())
      .catch(reload);
  }

  function remove(item: ChecklistItem) {
    setItems((prev) => prev.filter((i) => i.id !== item.id));
    api
      .deleteChecklistItem(item.id)
      .then(() => onChanged?.())
      .catch(reload);
  }

  const done = items.filter((i) => i.done).length;

  return (
    <div className="grid gap-2">
      <p className="text-xs font-medium text-muted-foreground">
        Checklist{items.length > 0 ? ` ${done}/${items.length}` : ""}
      </p>

      {items.length > 0 && (
        <ul className="grid gap-1">
          {items.map((item) => (
            <li key={item.id} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={item.done}
                onChange={() => toggle(item)}
                aria-label={item.content}
                className="size-4 shrink-0 accent-primary"
              />
              <span
                className={`flex-1 text-sm ${item.done ? "text-muted-foreground line-through" : ""}`}
              >
                {item.content}
              </span>
              <button
                type="button"
                aria-label={`Remove "${item.content}"`}
                onClick={() => remove(item)}
                className="shrink-0 rounded p-1 text-muted-foreground hover:text-destructive"
              >
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-1.5">
        <Input
          value={draft}
          placeholder="Add an item"
          aria-label="Add checklist item"
          maxLength={CHECKLIST_CONTENT_MAX}
          className="h-8"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void add();
            }
          }}
        />
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-8 shrink-0"
          aria-label="Add item"
          disabled={!draft.trim() || busy}
          onClick={add}
        >
          <Plus />
        </Button>
      </div>
    </div>
  );
}
