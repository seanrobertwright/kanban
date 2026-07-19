"use client";

import { useState } from "react";
import { Pencil, Trash2 } from "lucide-react";

import { LabelChip } from "@/features/labels/components/label-chip";
import { LabelPicker } from "@/features/labels/components/label-picker";
import type { Label as LabelData } from "@/features/labels/types";
import { PriorityDot } from "@/features/tasks/components/task-card";
import { PRIORITY_LABELS, PRIORITY_ORDER } from "@/features/tasks/types";
import type { TaskPriority } from "@/features/tasks/types";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Label as FieldLabel } from "@/shared/ui/label";
import { Textarea } from "@/shared/ui/textarea";
import * as templatesApi from "../client/api";
import { TEMPLATE_TITLE_MAX } from "../types";
import type { TaskTemplate } from "../types";

interface TemplatesDialogProps {
  open: boolean;
  workspaceId: string;
  templates: TaskTemplate[];
  /** The workspace vocabulary — a template's labels are chosen from it (007). */
  labels: LabelData[];
  /** False for viewers, who may read templates but not mint or change them. */
  canEdit: boolean;
  onOpenChange: (open: boolean) => void;
  /** The template set changed; the board re-reads it for the New-task picker. */
  onChanged: (templates: TaskTemplate[]) => void;
}

const BLANK = { title: "", description: "", priority: "none" as TaskPriority, labelIds: [] as number[] };

/**
 * Where task templates are managed — the shared shapes a New task can start from.
 *
 * Its own dialog off the board header, beside Labels, because a template is
 * workspace config like the vocabulary is (019) rather than something edited in
 * the flow of one task. The form doubles as create and edit: picking a template's
 * pencil loads it in, Save writes it back, and the list below reflects the change.
 */
export function TemplatesDialog({
  open,
  workspaceId,
  templates,
  labels,
  canEdit,
  onOpenChange,
  onChanged,
}: TemplatesDialogProps) {
  // null means the form is creating; a number means it is editing that template.
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState(BLANK);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function resetForm() {
    setEditingId(null);
    setForm(BLANK);
  }

  function startEdit(template: TaskTemplate) {
    setEditingId(template.id);
    setForm({
      title: template.title,
      description: template.description,
      priority: template.priority,
      // Back to ids: the template carries {id, name} because a name has to
      // survive a label's deletion in the log's world, but the form's business is
      // which labels, not what they are called (task-dialog's own reset does this).
      labelIds: template.labels.map((l) => l.id),
    });
    setError(null);
  }

  async function reload() {
    onChanged(await templatesApi.fetchTemplates(workspaceId));
  }

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await reload();
    } catch (e) {
      // The server's sentence — "No such label in this workspace", say — is the
      // whole answer, so it is shown rather than a generic one.
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const title = form.title.trim();
    if (!title) return;
    const input = {
      title,
      description: form.description,
      priority: form.priority,
      labelIds: form.labelIds,
    };
    await run(async () => {
      if (editingId === null) {
        await templatesApi.createTemplate(workspaceId, input);
      } else {
        await templatesApi.updateTemplate(editingId, input);
      }
      resetForm();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) resetForm();
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Templates</DialogTitle>
          <DialogDescription>
            Saved task shapes for this workspace. Start a new task from one.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}

        <ul className="grid max-h-56 gap-1 overflow-y-auto">
          {templates.length === 0 && (
            <li className="py-2 text-xs text-muted-foreground">
              No templates yet.
            </li>
          )}
          {templates.map((template) => (
            <li key={template.id} className="flex items-center gap-2">
              <PriorityDot priority={template.priority} />
              <span className="flex-1 truncate text-sm">{template.title}</span>
              {template.labels.length > 0 && (
                <span className="flex shrink-0 flex-wrap justify-end gap-1">
                  {template.labels.map((label) => (
                    <LabelChip
                      key={label.id}
                      name={label.name}
                      color={labels.find((l) => l.id === label.id)?.color}
                    />
                  ))}
                </span>
              )}
              {canEdit && (
                <>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 shrink-0 text-muted-foreground"
                    disabled={busy}
                    aria-label={`Edit ${template.title}`}
                    onClick={() => startEdit(template)}
                  >
                    <Pencil />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 shrink-0 text-muted-foreground"
                    disabled={busy}
                    aria-label={`Delete ${template.title}`}
                    onClick={() =>
                      run(async () => {
                        await templatesApi.deleteTemplate(template.id);
                        if (editingId === template.id) resetForm();
                      })
                    }
                  >
                    <Trash2 />
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>

        {canEdit && (
          <form onSubmit={handleSubmit} className="grid gap-2 border-t pt-3">
            <FieldLabel htmlFor="template-title">
              {editingId === null ? "New template" : "Edit template"}
            </FieldLabel>
            <Input
              id="template-title"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="Bug report"
              maxLength={TEMPLATE_TITLE_MAX}
            />
            <Textarea
              aria-label="Template description"
              value={form.description}
              onChange={(e) =>
                setForm((f) => ({ ...f, description: e.target.value }))
              }
              placeholder="Steps to reproduce, expected vs actual…"
              rows={3}
            />
            <div className="grid grid-cols-2 items-end gap-3">
              <div className="grid gap-1.5">
                <FieldLabel htmlFor="template-priority">Priority</FieldLabel>
                <select
                  id="template-priority"
                  value={form.priority}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      priority: e.target.value as TaskPriority,
                    }))
                  }
                  className="h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30"
                >
                  {[...PRIORITY_ORDER].reverse().map((value) => (
                    <option key={value} value={value}>
                      {PRIORITY_LABELS[value]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid gap-1.5">
                <FieldLabel>Labels</FieldLabel>
                <LabelPicker
                  labels={labels}
                  selected={form.labelIds}
                  onChange={(labelIds) => setForm((f) => ({ ...f, labelIds }))}
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                type="submit"
                size="sm"
                disabled={busy || !form.title.trim()}
              >
                {editingId === null ? "Add template" : "Save changes"}
              </Button>
              {editingId !== null && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={resetForm}
                >
                  Cancel
                </Button>
              )}
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
