"use client";

import { useState } from "react";
import { Bookmark, BookmarkPlus, Check, Trash2, X } from "lucide-react";

import type { BoardFilter } from "@/features/board/components/board-filter-bar";
import { Button } from "@/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { Input } from "@/shared/ui/input";
import * as viewsApi from "../client/api";
import { SAVED_VIEW_NAME_MAX, type BoardViewMode, type SavedView } from "../types";

interface SavedViewsProps {
  workspaceId: string;
  views: SavedView[];
  onViewsChange: (next: SavedView[]) => void;
  /** The lens + filter a "save" captures. */
  currentView: BoardViewMode;
  currentFilter: BoardFilter;
  /** Apply a saved view — the board sets its lens and filter from it. */
  onApply: (view: SavedView) => void;
}

/**
 * A member's saved views: pick one to apply its lens + filter, or name the
 * current board state to save it. Private to the caller (the server scopes every
 * query to the session user), so there is no sharing or ownership UI — every row
 * here is yours.
 */
export function SavedViews({
  workspaceId,
  views,
  onViewsChange,
  currentView,
  currentFilter,
  onApply,
}: SavedViewsProps) {
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const created = await viewsApi.createSavedView(workspaceId, {
        name: trimmed,
        viewMode: currentView,
        filter: currentFilter,
      });
      // Upsert on the client too: the server overwrites a same-name view, so
      // replace any row of that name rather than appending a duplicate.
      const rest = views.filter(
        (v) => v.name.toLowerCase() !== created.name.toLowerCase()
      );
      onViewsChange(
        [...rest, created].sort((a, b) => a.name.localeCompare(b.name))
      );
      setName("");
      setSaving(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the view");
    } finally {
      setBusy(false);
    }
  }

  async function remove(view: SavedView) {
    onViewsChange(views.filter((v) => v.id !== view.id));
    try {
      await viewsApi.deleteSavedView(view.id);
    } catch {
      // Put it back if the server refused.
      onViewsChange([...views]);
    }
  }

  return (
    <div className="flex items-center gap-1.5">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
            >
              <Bookmark /> Views
              {views.length > 0 && (
                <span className="tabular-nums">({views.length})</span>
              )}
            </Button>
          }
        />
        <DropdownMenuContent align="end" className="w-56 p-1">
          {views.length === 0 ? (
            <p className="px-2 py-1.5 text-sm text-muted-foreground">
              No saved views yet.
            </p>
          ) : (
            views.map((view) => (
              <div
                key={view.id}
                className="flex items-center gap-1 rounded-md hover:bg-accent"
              >
                <button
                  type="button"
                  onClick={() => onApply(view)}
                  className="flex flex-1 items-center gap-2 truncate rounded-md px-2 py-1.5 text-left text-sm outline-none"
                >
                  <span className="flex-1 truncate">{view.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground capitalize">
                    {view.viewMode}
                  </span>
                </button>
                <button
                  type="button"
                  aria-label={`Delete view ${view.name}`}
                  onClick={() => remove(view)}
                  className="mr-1 shrink-0 rounded p-1 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {saving ? (
        <div className="flex items-center gap-1">
          <Input
            value={name}
            autoFocus
            aria-label="View name"
            placeholder="Name this view"
            maxLength={SAVED_VIEW_NAME_MAX}
            className="h-8 w-40"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void save();
              if (e.key === "Escape") {
                setSaving(false);
                setName("");
                setError(null);
              }
            }}
          />
          <Button
            size="icon"
            className="size-8"
            aria-label="Save view"
            disabled={!name.trim() || busy}
            onClick={save}
          >
            <Check />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="size-8"
            aria-label="Cancel"
            onClick={() => {
              setSaving(false);
              setName("");
              setError(null);
            }}
          >
            <X />
          </Button>
          {error && (
            <span role="alert" className="text-xs text-destructive">
              {error}
            </span>
          )}
        </div>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={() => setSaving(true)}
        >
          <BookmarkPlus /> Save
        </Button>
      )}
    </div>
  );
}
