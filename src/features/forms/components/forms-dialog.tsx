"use client";

import { ClipboardList } from "lucide-react";
import { EmptyState } from "@/shared/ui/empty-state";
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
import * as sharingApi from "@/features/sharing/client/api";
import { publicPathForToken } from "@/features/sharing/types";
import { OPERATORS, type Operator } from "@/features/automations/types";
import {
  FORM_FIELD_TYPES,
  FORM_MAX_FIELDS,
  type Form,
  type FormField,
  type FormFieldType,
  type FormRoute,
} from "../types";
import { Select, SelectItem } from "@/shared/ui/select";

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
          <EmptyState icon={ClipboardList} title="No forms yet" hint="A form is a public intake page: someone outside the workspace submits it, and the answers land in the column you choose." />
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
  const [sharing, setSharing] = useState(false);

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
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 px-1.5 text-xs text-muted-foreground"
              disabled={busy}
              onClick={() => setSharing((v) => !v)}
            >
              Public link
            </Button>
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

      {sharing && <PublicLinkPanel formId={form.id} />}

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

/**
 * Public intake links for one form (§3.9): mint a tokenized submit URL, copy
 * it, revoke it. Minting is a workspace-admin power server-side — a member who
 * opens this panel sees the server's refusal rather than a hidden button.
 */
function PublicLinkPanel({ formId }: { formId: number }) {
  const [links, setLinks] = useState<sharingApi.PublicLink[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copiedId, setCopiedId] = useState<number | null>(null);

  async function load() {
    try {
      setError(null);
      setLinks(await sharingApi.fetchPublicLinks("form", String(formId)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load public links");
    }
  }
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formId]);

  async function run(action: () => Promise<unknown>, failure: string) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : failure);
    } finally {
      setBusy(false);
    }
  }

  async function copy(link: sharingApi.PublicLink) {
    try {
      await navigator.clipboard.writeText(
        `${window.location.origin}${publicPathForToken("form", link.token)}`
      );
      setCopiedId(link.id);
      setTimeout(() => setCopiedId((prev) => (prev === link.id ? null : prev)), 1500);
    } catch {
      setError("Could not copy — copy the URL manually");
    }
  }

  return (
    <div className="grid gap-1.5 rounded-md bg-muted/40 p-2">
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      {links.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No public link yet — anyone with one can submit this form without
          signing in.
        </p>
      ) : (
        <ul className="grid gap-1">
          {links.map((link) => (
            <li key={link.id} className="flex items-center gap-1.5">
              <span className="min-w-0 flex-1 truncate font-mono text-xs">
                {publicPathForToken("form", link.token)}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {link.expiresAt
                  ? `expires ${new Date(link.expiresAt).toLocaleDateString()}`
                  : "no expiry"}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 px-1.5 text-xs"
                onClick={() => void copy(link)}
              >
                {copiedId === link.id ? "Copied" : "Copy"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 px-1.5 text-xs text-muted-foreground hover:text-destructive"
                disabled={busy}
                onClick={() =>
                  run(
                    () => sharingApi.revokePublicLink(link.id),
                    "Could not revoke the link"
                  )
                }
              >
                Revoke
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="h-6 w-fit px-2 text-xs"
        disabled={busy}
        onClick={() =>
          run(
            () => sharingApi.mintPublicLink("form", String(formId), "submit"),
            "Could not create the link"
          )
        }
      >
        New public link
      </Button>
    </div>
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
        <Select
          aria-label="Target column"
          className="h-8 rounded-md px-2"
          value={targetColumnId}
          onValueChange={(value) => setTargetColumnId(value)}
        >
          <SelectItem value="">First column</SelectItem>
          {columns.map((c) => (
            <SelectItem key={c.id} value={String(c.id)}>
              {c.title}
            </SelectItem>
          ))}
        </Select>
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
            <Select
              aria-label={`Question ${i + 1} type`}
              className="h-7 rounded-md px-1 text-xs"
              value={field.type}
              onValueChange={(value) =>
                setField(i, { type: value as FormFieldType })
              }
            >
              {FORM_FIELD_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </Select>
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
            <Select
              aria-label={`Route ${i + 1} question`}
              className="h-7 rounded-md px-1 text-xs"
              value={r.field}
              onValueChange={(value) =>
                setRoutes((prev) => prev.map((x, idx) => (idx === i ? { ...x, field: value } : x)))
              }
            >
              <SelectItem value="">question…</SelectItem>
              {fields.map((f, fi) => (
                <SelectItem key={fi} value={f.label}>
                  {f.label || `Q${fi + 1}`}
                </SelectItem>
              ))}
            </Select>
            <Select
              aria-label={`Route ${i + 1} operator`}
              className="h-7 rounded-md px-1 text-xs"
              value={r.op}
              onValueChange={(value) =>
                setRoutes((prev) => prev.map((x, idx) => (idx === i ? { ...x, op: value as Operator } : x)))
              }
            >
              {OPERATORS.map((op) => (
                <SelectItem key={op} value={op}>
                  {op}
                </SelectItem>
              ))}
            </Select>
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
            <Select
              aria-label={`Route ${i + 1} column`}
              className="h-7 rounded-md px-1 text-xs"
              value={r.columnId}
              onValueChange={(value) =>
                setRoutes((prev) => prev.map((x, idx) => (idx === i ? { ...x, columnId: value } : x)))
              }
            >
              <SelectItem value="">column…</SelectItem>
              {columns.map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>
                  {c.title}
                </SelectItem>
              ))}
            </Select>
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
