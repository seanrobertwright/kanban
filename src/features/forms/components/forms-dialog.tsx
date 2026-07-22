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
import { Textarea } from "@/shared/ui/textarea";
import * as api from "../client/api";
import { OPERATORS, type Operator } from "@/features/automations/types";
import {
  FORM_FIELD_TYPES,
  FORM_MAX_FIELDS,
  type Form,
  type FormField,
  type FormFieldType,
  type FormRoute,
} from "../types";

interface FormsColumn {
  id: number;
  title: string;
}

interface FormsDialogProps {
  boardId: number;
  open: boolean;
  /** For the target-column picker and to name a form's destination. */
  columns: FormsColumn[];
  /** member+ may manage forms and submit them; a viewer sees them read-only. */
  canEdit: boolean;
  onOpenChange: (open: boolean) => void;
  /** A submission creates a task, so the board is stale — refetch it. */
  onSubmitted: () => void;
}

/**
 * Forms / intake (039): the board's reusable intake definitions. A form is a
 * name, a target column, and a list of questions; submitting one creates a task
 * (first answer → title, the rest compiled into the description). Self-fetching
 * like the Timesheet and Insights dialogs — forms are not on BoardData because no
 * card or picker needs them on first paint, only this surface does.
 */
export function FormsDialog({
  boardId,
  open,
  columns,
  canEdit,
  onOpenChange,
  onSubmitted,
}: FormsDialogProps) {
  const [forms, setForms] = useState<Form[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        setError(null);
        const list = await api.fetchForms(boardId);
        if (!cancelled) setForms(list);
      } catch (e) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "Could not load forms");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, boardId]);

  async function reload() {
    setForms(await api.fetchForms(boardId));
  }

  async function run(action: () => Promise<unknown>, failure: string) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await reload();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : failure);
      return false;
    } finally {
      setBusy(false);
    }
  }

  const columnName = (id: number | null) =>
    id === null
      ? "First column"
      : columns.find((c) => c.id === id)?.title ?? "First column";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Forms</DialogTitle>
          <DialogDescription>
            Structured intake. A submission creates a task — the first answer
            becomes its title, the rest its description.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        {forms.length === 0 ? (
          <p className="text-sm text-muted-foreground">No forms yet.</p>
        ) : (
          <ul className="grid gap-3">
            {forms.map((form) => (
              <FormCard
                key={form.id}
                form={form}
                columnName={columnName(form.targetColumnId)}
                canEdit={canEdit}
                busy={busy}
                run={run}
                onSubmitted={onSubmitted}
              />
            ))}
          </ul>
        )}

        {canEdit && (
          <CreateForm boardId={boardId} columns={columns} busy={busy} run={run} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function FormCard({
  form,
  columnName,
  canEdit,
  busy,
  run,
  onSubmitted,
}: {
  form: Form;
  columnName: string;
  canEdit: boolean;
  busy: boolean;
  run: (action: () => Promise<unknown>, failure: string) => Promise<boolean>;
  onSubmitted: () => void;
}) {
  const [filling, setFilling] = useState(false);
  const [confirming, setConfirming] = useState(false);

  return (
    <li className="grid gap-2 rounded-lg border px-3 py-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {form.name}
            {!form.isOpen && (
              <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground">
                closed
              </span>
            )}
          </p>
          {form.description && (
            <p className="truncate text-xs text-muted-foreground">
              {form.description}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            {form.fields.length}{" "}
            {form.fields.length === 1 ? "question" : "questions"} → {columnName}
          </p>
        </div>
        {canEdit && (
          <div className="flex shrink-0 items-center gap-1">
            {form.isOpen && (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="h-6 px-2 text-xs"
                disabled={busy}
                onClick={() => setFilling((v) => !v)}
              >
                {filling ? "Close" : "Fill"}
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 px-1.5 text-xs text-muted-foreground"
              disabled={busy}
              onClick={() =>
                run(
                  () => api.updateForm(form.id, { isOpen: !form.isOpen }),
                  "Could not update the form"
                )
              }
            >
              {form.isOpen ? "Pause" : "Reopen"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 px-1.5 text-xs text-muted-foreground hover:text-destructive"
              disabled={busy}
              onClick={() =>
                confirming
                  ? run(() => api.deleteForm(form.id), "Could not delete the form")
                  : setConfirming(true)
              }
              onBlur={() => setConfirming(false)}
            >
              {confirming ? "Really?" : "Delete"}
            </Button>
          </div>
        )}
      </div>

      {filling && form.isOpen && (
        <FillForm
          form={form}
          onDone={() => {
            setFilling(false);
            onSubmitted();
          }}
        />
      )}
    </li>
  );
}

/** The submission panel — one input per question, submit creates a task. */
function FillForm({ form, onDone }: { form: Form; onDone: () => void }) {
  const [answers, setAnswers] = useState<string[]>(form.fields.map(() => ""));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set(index: number, value: string) {
    setAnswers((prev) => prev.map((a, i) => (i === index ? value : a)));
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api.submitForm(form.id, { answers });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not submit");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-2 rounded-md bg-muted/40 p-2">
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      {form.fields.map((field, i) => (
        <div key={i} className="grid gap-1">
          <Label className="text-xs" htmlFor={`form-${form.id}-field-${i}`}>
            {field.label}
            {(field.required || i === 0) && (
              <span className="text-destructive"> *</span>
            )}
          </Label>
          {field.type === "textarea" ? (
            <Textarea
              id={`form-${form.id}-field-${i}`}
              value={answers[i]}
              rows={2}
              onChange={(e) => set(i, e.target.value)}
            />
          ) : (
            <Input
              id={`form-${form.id}-field-${i}`}
              type={field.type === "number" ? "number" : "text"}
              value={answers[i]}
              onChange={(e) => set(i, e.target.value)}
            />
          )}
        </div>
      ))}
      <Button
        type="button"
        size="sm"
        className="justify-self-end"
        disabled={busy}
        onClick={submit}
      >
        Submit
      </Button>
    </div>
  );
}

/** The form builder: name, target column, and a list of questions. */
function CreateForm({
  boardId,
  columns,
  busy,
  run,
}: {
  boardId: number;
  columns: FormsColumn[];
  busy: boolean;
  run: (action: () => Promise<unknown>, failure: string) => Promise<boolean>;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [targetColumnId, setTargetColumnId] = useState<string>("");
  const [fields, setFields] = useState<FormField[]>([
    { label: "Title", type: "text", required: true },
  ]);
  // Routing (1.7): each row sends submissions matching one answer condition to a
  // chosen column. Kept simple — one predicate per route — over the raw tree.
  const [routes, setRoutes] = useState<
    { field: string; op: Operator; value: string; columnId: string }[]
  >([]);

  function setField(index: number, patch: Partial<FormField>) {
    setFields((prev) =>
      prev.map((f, i) => (i === index ? { ...f, ...patch } : f))
    );
  }

  const canAdd =
    name.trim() !== "" && fields.every((f) => f.label.trim() !== "");

  async function create() {
    if (!canAdd) return;
    const ok = await run(
      () =>
        api.createForm(boardId, {
          name: name.trim(),
          description: description.trim() || undefined,
          targetColumnId: targetColumnId === "" ? null : Number(targetColumnId),
          fields: fields.map((f) => ({ ...f, label: f.label.trim() })),
          routing: routes
            .filter((r) => r.field.trim() !== "" && r.columnId !== "")
            .map(
              (r): FormRoute => ({
                conditions: { field: r.field.trim(), op: r.op, value: r.value },
                columnId: Number(r.columnId),
              })
            ),
        }),
      "Could not create the form"
    );
    if (ok) {
      setName("");
      setDescription("");
      setTargetColumnId("");
      setFields([{ label: "Title", type: "text", required: true }]);
      setRoutes([]);
    }
  }

  return (
    <div className="grid gap-2 border-t pt-3">
      <Label htmlFor="form-name">New form</Label>
      <Input
        id="form-name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Bug report"
      />
      <Input
        aria-label="Form description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="What this intake is for (optional)"
      />
      <label className="grid gap-1 text-xs text-muted-foreground">
        Lands in
        <select
          aria-label="Target column"
          className="h-8 rounded-md border bg-transparent px-2 text-sm text-foreground"
          value={targetColumnId}
          onChange={(e) => setTargetColumnId(e.target.value)}
        >
          <option value="">First column</option>
          {columns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </select>
      </label>

      <p className="text-xs text-muted-foreground">
        Questions — the first answer becomes the task title.
      </p>
      <ul className="grid gap-1.5">
        {fields.map((field, i) => (
          <li key={i} className="flex items-center gap-1.5">
            <Input
              aria-label={`Question ${i + 1} label`}
              value={field.label}
              onChange={(e) => setField(i, { label: e.target.value })}
              placeholder="Question"
              className="h-7 text-xs"
            />
            <select
              aria-label={`Question ${i + 1} type`}
              className="h-7 rounded-md border bg-transparent px-1 text-xs text-foreground"
              value={field.type}
              onChange={(e) =>
                setField(i, { type: e.target.value as FormFieldType })
              }
            >
              {FORM_FIELD_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-1 text-xs text-muted-foreground">
              <input
                type="checkbox"
                aria-label={`Question ${i + 1} required`}
                checked={field.required}
                onChange={(e) => setField(i, { required: e.target.checked })}
              />
              req
            </label>
            {fields.length > 1 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-1.5 text-xs text-muted-foreground hover:text-destructive"
                onClick={() =>
                  setFields((prev) => prev.filter((_, idx) => idx !== i))
                }
              >
                ✕
              </Button>
            )}
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        Routing — send a submission to a column based on an answer (1.7).
      </p>
      <ul className="grid gap-1.5">
        {routes.map((r, i) => (
          <li key={i} className="flex items-center gap-1.5">
            <select
              aria-label={`Route ${i + 1} question`}
              className="h-7 rounded-md border bg-transparent px-1 text-xs text-foreground"
              value={r.field}
              onChange={(e) =>
                setRoutes((prev) => prev.map((x, idx) => (idx === i ? { ...x, field: e.target.value } : x)))
              }
            >
              <option value="">question…</option>
              {fields.map((f, fi) => (
                <option key={fi} value={f.label}>
                  {f.label || `Q${fi + 1}`}
                </option>
              ))}
            </select>
            <select
              aria-label={`Route ${i + 1} operator`}
              className="h-7 rounded-md border bg-transparent px-1 text-xs text-foreground"
              value={r.op}
              onChange={(e) =>
                setRoutes((prev) => prev.map((x, idx) => (idx === i ? { ...x, op: e.target.value as Operator } : x)))
              }
            >
              {OPERATORS.map((op) => (
                <option key={op} value={op}>
                  {op}
                </option>
              ))}
            </select>
            <Input
              aria-label={`Route ${i + 1} value`}
              value={r.value}
              onChange={(e) =>
                setRoutes((prev) => prev.map((x, idx) => (idx === i ? { ...x, value: e.target.value } : x)))
              }
              placeholder="value"
              className="h-7 text-xs"
            />
            <span className="text-xs text-muted-foreground">→</span>
            <select
              aria-label={`Route ${i + 1} column`}
              className="h-7 rounded-md border bg-transparent px-1 text-xs text-foreground"
              value={r.columnId}
              onChange={(e) =>
                setRoutes((prev) => prev.map((x, idx) => (idx === i ? { ...x, columnId: e.target.value } : x)))
              }
            >
              <option value="">column…</option>
              {columns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-1.5 text-xs text-muted-foreground hover:text-destructive"
              onClick={() => setRoutes((prev) => prev.filter((_, idx) => idx !== i))}
            >
              ✕
            </Button>
          </li>
        ))}
      </ul>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="h-7 w-fit px-2 text-xs"
        onClick={() =>
          setRoutes((prev) => [...prev, { field: "", op: "eq", value: "", columnId: "" }])
        }
      >
        Add route
      </Button>

      <div className="flex items-center gap-2">
        {fields.length < FORM_MAX_FIELDS && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() =>
              setFields((prev) => [
                ...prev,
                { label: "", type: "text", required: false },
              ])
            }
          >
            Add question
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          className="ml-auto"
          disabled={busy || !canAdd}
          onClick={create}
        >
          Add form
        </Button>
      </div>
    </div>
  );
}
