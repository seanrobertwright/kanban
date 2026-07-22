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
  OPERATORS,
  SCHEDULE_INTERVALS,
  SETTABLE_FIELDS,
  TRIGGER_EVENTS,
  type Action,
  type AutomationRule,
  type AutomationRun,
  type AutomationTrigger,
  type Condition,
  type Operator,
  type Predicate,
  type ScheduleInterval,
  type SettableField,
  type TriggerEvent,
} from "../types";

interface AutomationsColumn {
  id: number;
  title: string;
}
interface AutomationsLabel {
  id: number;
  name: string;
}

interface AutomationsDialogProps {
  boardId: number;
  open: boolean;
  columns: AutomationsColumn[];
  labels: AutomationsLabel[];
  /** admin+ may author rules; a member/viewer sees them and the run-log read-only. */
  canManage: boolean;
  onOpenChange: (open: boolean) => void;
  /** A rule can mutate the board (move, set field), so a fire leaves it stale. */
  onChanged: () => void;
}

/**
 * Automations (045, rocks 1.1 no-code automations + 1.2 conditional branching):
 * the board's trigger→conditions→actions recipes. Self-fetching like FormsDialog
 * — rules are not on BoardData because nothing on first paint needs them, only
 * this surface does. Authoring is admin (a rule acts as the workspace); everyone
 * who can see the board can read the rules and their run-log.
 */
export function AutomationsDialog({
  boardId,
  open,
  columns,
  labels,
  canManage,
  onOpenChange,
  onChanged,
}: AutomationsDialogProps) {
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        setError(null);
        const list = await api.fetchAutomations(boardId);
        if (!cancelled) setRules(list);
      } catch (e) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "Could not load automations");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, boardId]);

  async function reload() {
    setRules(await api.fetchAutomations(boardId));
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Automations</DialogTitle>
          <DialogDescription>
            When something happens on this board, if the conditions hold, do these
            actions — automatically.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        {rules.length === 0 ? (
          <p className="text-sm text-muted-foreground">No automations yet.</p>
        ) : (
          <ul className="grid gap-3">
            {rules.map((rule) => (
              <RuleCard
                key={rule.id}
                rule={rule}
                columns={columns}
                labels={labels}
                canManage={canManage}
                busy={busy}
                run={run}
              />
            ))}
          </ul>
        )}

        {canManage && (
          <CreateRule
            boardId={boardId}
            columns={columns}
            labels={labels}
            busy={busy}
            run={run}
            onCreated={onChanged}
          />
        )}

        {canManage && (
          <WorkflowMatrix boardId={boardId} columns={columns} open={open} />
        )}

        {canManage && <InboundTriggers boardId={boardId} open={open} />}
      </DialogContent>
    </Dialog>
  );
}

/** Human-readable summaries so a saved rule reads back as a sentence. */
const EVENT_LABELS: Record<TriggerEvent, string> = {
  "task.created": "a task is created",
  "task.moved": "a task is moved",
  "task.updated": "a task is edited",
  "task.assigned": "a task is assigned",
  "task.prioritized": "a task's priority changes",
  "task.scheduled": "a task's dates change",
  "task.labeled": "a task's labels change",
  "schedule.tick": "on a schedule",
  "external.trigger": "an external tool fires it",
};

function summarizeAction(a: Action, columns: AutomationsColumn[], labels: AutomationsLabel[]): string {
  switch (a.type) {
    case "move":
      return `move to ${columns.find((c) => c.id === a.columnId)?.title ?? `column ${a.columnId}`}`;
    case "set_field":
      return `set ${a.field} to ${a.value === null ? "none" : a.value}`;
    case "add_label":
      return `add label ${labels.find((l) => l.id === a.labelId)?.name ?? a.labelId}`;
    case "comment":
      return `comment "${a.body}"`;
    case "assign":
      return a.assignee ? `assign to ${a.assignee.id}` : "unassign";
    case "notify":
      return `notify ${a.target === "assignee" ? "assignee" : a.target.id}`;
  }
}

function RuleCard({
  rule,
  columns,
  labels,
  canManage,
  busy,
  run,
}: {
  rule: AutomationRule;
  columns: AutomationsColumn[];
  labels: AutomationsLabel[];
  canManage: boolean;
  busy: boolean;
  run: (action: () => Promise<unknown>, failure: string) => Promise<boolean>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [runs, setRuns] = useState<AutomationRun[] | null>(null);
  const [showRuns, setShowRuns] = useState(false);

  async function toggleRuns() {
    if (showRuns) return setShowRuns(false);
    setShowRuns(true);
    if (runs === null) setRuns(await api.fetchAutomationRuns(rule.id));
  }

  const conditionCount =
    "all" in rule.conditions
      ? rule.conditions.all.length
      : "any" in rule.conditions
        ? rule.conditions.any.length
        : 0;

  return (
    <li className="grid gap-2 rounded-lg border px-3 py-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {rule.name}
            {!rule.isEnabled && (
              <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground">
                paused
              </span>
            )}
          </p>
          <p className="text-xs text-muted-foreground">
            When {EVENT_LABELS[rule.trigger.event] ?? rule.trigger.event}
            {conditionCount > 0 && `, if ${conditionCount} condition${conditionCount === 1 ? "" : "s"}`}
            , then{" "}
            {rule.actions.length === 0
              ? "(no actions yet)"
              : rule.actions.map((a) => summarizeAction(a, columns, labels)).join("; ")}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-1.5 text-xs text-muted-foreground"
            disabled={busy}
            onClick={toggleRuns}
          >
            {showRuns ? "Hide log" : "Log"}
          </Button>
          {canManage && (
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 px-1.5 text-xs text-muted-foreground"
                disabled={busy}
                onClick={() =>
                  run(
                    () => api.updateAutomation(rule.id, { isEnabled: !rule.isEnabled }),
                    "Could not update the rule"
                  )
                }
              >
                {rule.isEnabled ? "Pause" : "Enable"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 px-1.5 text-xs text-muted-foreground hover:text-destructive"
                disabled={busy}
                onClick={() =>
                  confirming
                    ? run(() => api.deleteAutomation(rule.id), "Could not delete the rule")
                    : setConfirming(true)
                }
                onBlur={() => setConfirming(false)}
              >
                {confirming ? "Really?" : "Delete"}
              </Button>
            </>
          )}
        </div>
      </div>

      {showRuns && (
        <div className="grid gap-1 rounded-md bg-muted/40 p-2 text-xs">
          {runs === null ? (
            <p className="text-muted-foreground">Loading…</p>
          ) : runs.length === 0 ? (
            <p className="text-muted-foreground">Never fired.</p>
          ) : (
            <ul className="grid gap-0.5">
              {runs.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2">
                  <span className={r.status === "error" ? "text-destructive" : "text-foreground"}>
                    {r.status}
                  </span>
                  <span className="text-muted-foreground">
                    {new Date(r.createdAt).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * State transition rules (046, rock 1.3): a columns×columns matrix of the moves
 * a task is allowed to make. Enforcing is opt-in — off means today's any→any;
 * on with a from-column's row all-unchecked would lock that column, so the empty
 * matrix (nothing checked) is a valid "only the moves you tick". Guards on edges
 * are supported by the engine but edited elsewhere; this grid is the allowed map.
 */
function WorkflowMatrix({
  boardId,
  columns,
  open,
}: {
  boardId: number;
  columns: AutomationsColumn[];
  open: boolean;
}) {
  const [enforced, setEnforced] = useState(false);
  const [allowed, setAllowed] = useState<Record<string, number[]>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const wf = await api.fetchWorkflow(boardId);
        if (cancelled) return;
        setEnforced(wf !== null);
        setAllowed(wf?.allowed ?? {});
      } catch {
        /* the rule list already surfaces load errors */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, boardId]);

  function isAllowed(from: number, to: number): boolean {
    return allowed[String(from)]?.includes(to) ?? false;
  }
  function toggle(from: number, to: number) {
    setSaved(false);
    setAllowed((prev) => {
      const key = String(from);
      const set = new Set(prev[key] ?? []);
      if (set.has(to)) set.delete(to);
      else set.add(to);
      return { ...prev, [key]: [...set] };
    });
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.saveWorkflow(boardId, enforced ? { allowed } : null);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save transitions");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-2 border-t pt-3">
      <label className="flex items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          checked={enforced}
          onChange={(e) => {
            setEnforced(e.target.checked);
            setSaved(false);
          }}
        />
        Enforce allowed column transitions
      </label>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      {enforced && (
        <div className="overflow-x-auto">
          <table className="text-xs">
            <thead>
              <tr>
                <th className="p-1 text-left font-normal text-muted-foreground">from ↓ / to →</th>
                {columns.map((c) => (
                  <th key={c.id} className="max-w-16 truncate p-1 font-normal text-muted-foreground">
                    {c.title}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {columns.map((from) => (
                <tr key={from.id}>
                  <td className="max-w-24 truncate p-1 text-muted-foreground">{from.title}</td>
                  {columns.map((to) => (
                    <td key={to.id} className="p-1 text-center">
                      {from.id === to.id ? (
                        <span className="text-muted-foreground">·</span>
                      ) : (
                        <input
                          type="checkbox"
                          aria-label={`allow ${from.title} to ${to.title}`}
                          checked={isAllowed(from.id, to.id)}
                          onChange={() => toggle(from.id, to.id)}
                        />
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Button
        type="button"
        size="sm"
        className="w-fit"
        disabled={busy}
        onClick={save}
      >
        {saved ? "Saved" : "Save transitions"}
      </Button>
    </div>
  );
}

/**
 * Inbound trigger tokens (1.12): mint a per-board token an external tool POSTs to
 * (POST /api/board/:id/triggers/:token) to fire the board's "external tool fires
 * it" rules. Admin-only. The token is the credential, so the row shows the full
 * fire URL to copy once; revoke or delete disables it.
 */
function InboundTriggers({ boardId, open }: { boardId: number; open: boolean }) {
  const [triggers, setTriggers] = useState<AutomationTrigger[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const list = await api.fetchTriggers(boardId);
        if (!cancelled) setTriggers(list);
      } catch {
        /* the rule list surfaces load errors */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, boardId]);

  async function reload() {
    setTriggers(await api.fetchTriggers(boardId));
  }
  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      await reload();
    } finally {
      setBusy(false);
    }
  }

  const origin = typeof window !== "undefined" ? window.location.origin : "";

  return (
    <div className="grid gap-2 border-t pt-3">
      <p className="text-sm font-medium">Inbound triggers</p>
      <p className="text-xs text-muted-foreground">
        POST a token URL from n8n / Make / a script to fire this board&apos;s
        &ldquo;external tool fires it&rdquo; rules.
      </p>
      {triggers.length > 0 && (
        <ul className="grid gap-1.5">
          {triggers.map((t) => (
            <li key={t.id} className="grid gap-0.5 rounded-md border px-2 py-1.5 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">
                  {t.name || "trigger"}
                  {!t.isActive && (
                    <span className="ml-2 rounded bg-muted px-1 text-muted-foreground">revoked</span>
                  )}
                </span>
                <span className="flex gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 px-1.5 text-xs text-muted-foreground"
                    disabled={busy}
                    onClick={() => act(() => api.setTriggerActive(t.id, !t.isActive))}
                  >
                    {t.isActive ? "Revoke" : "Reactivate"}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 px-1.5 text-xs text-muted-foreground hover:text-destructive"
                    disabled={busy}
                    onClick={() => act(() => api.deleteTrigger(t.id))}
                  >
                    Delete
                  </Button>
                </span>
              </div>
              <code className="block truncate text-muted-foreground">
                POST {origin}/api/board/{boardId}/triggers/{t.token}
              </code>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-2">
        <Input
          aria-label="Trigger name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name (e.g. n8n)"
          className="h-7 text-xs"
        />
        <Button
          type="button"
          size="sm"
          className="h-7 px-2 text-xs"
          disabled={busy}
          onClick={async () => {
            await act(() => api.createTrigger(boardId, name.trim()));
            setName("");
          }}
        >
          Mint token
        </Button>
      </div>
    </div>
  );
}

// ── The builder — When · If · Then ──────────────────────────────────────────

/** A predicate row in the builder before it is compiled to the API shape. */
interface PredicateRow {
  field: string;
  op: Operator;
  value: string;
}

/** Fields offered in the condition builder; numeric ones coerce their value. */
const CONDITION_FIELDS: { field: string; label: string; numeric?: boolean }[] = [
  { field: "priority", label: "Priority" },
  { field: "type", label: "Type" },
  { field: "columnId", label: "Column id", numeric: true },
  { field: "title", label: "Title" },
  { field: "assignee.id", label: "Assignee id" },
  { field: "labels", label: "Labels (contains id)", numeric: true },
  { field: "estimate", label: "Estimate", numeric: true },
  { field: "dueDate", label: "Due date" },
];

const UNARY_OPS: Operator[] = ["isSet", "isEmpty"];

/** A pending action row in the builder. */
type ActionDraft =
  | { type: "move"; columnId: string }
  | { type: "set_field"; field: SettableField; value: string }
  | { type: "add_label"; labelId: string }
  | { type: "comment"; body: string }
  | { type: "notify"; message: string };

function CreateRule({
  boardId,
  columns,
  labels,
  busy,
  run,
  onCreated,
}: {
  boardId: number;
  columns: AutomationsColumn[];
  labels: AutomationsLabel[];
  busy: boolean;
  run: (action: () => Promise<unknown>, failure: string) => Promise<boolean>;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [event, setEvent] = useState<TriggerEvent>("task.moved");
  const [every, setEvery] = useState<ScheduleInterval>("daily");
  const [combinator, setCombinator] = useState<"all" | "any">("all");
  const [predicates, setPredicates] = useState<PredicateRow[]>([]);
  const [actions, setActions] = useState<ActionDraft[]>([
    { type: "comment", body: "" },
  ]);

  function setPredicate(i: number, patch: Partial<PredicateRow>) {
    setPredicates((prev) => prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  }
  function setAction(i: number, next: ActionDraft) {
    setActions((prev) => prev.map((a, idx) => (idx === i ? next : a)));
  }

  const canAdd = name.trim() !== "" && actions.length > 0;

  /** Compiles the builder rows into the API's condition tree, coercing numeric
   *  field values and dropping the value for unary operators. */
  function buildConditions(): Condition {
    // The empty tree is the engine's always-true (no conditions → fires every
    // time); the Condition union describes only the shapes we build recursively,
    // so the empty form is stated with a cast here, the one place it originates.
    if (predicates.length === 0) return {} as Condition;
    const numeric = new Set(CONDITION_FIELDS.filter((f) => f.numeric).map((f) => f.field));
    const preds: Predicate[] = predicates.map((p) => {
      const pred: Predicate = { field: p.field, op: p.op };
      if (!UNARY_OPS.includes(p.op)) {
        pred.value = numeric.has(p.field) ? Number(p.value) : p.value;
      }
      return pred;
    });
    return combinator === "all" ? { all: preds } : { any: preds };
  }

  function buildActions(): Action[] {
    return actions.map((a): Action => {
      switch (a.type) {
        case "move":
          return { type: "move", columnId: Number(a.columnId) };
        case "set_field":
          return {
            type: "set_field",
            field: a.field,
            value: a.value === "" ? null : /^-?\d+$/.test(a.value) ? Number(a.value) : a.value,
          };
        case "add_label":
          return { type: "add_label", labelId: Number(a.labelId) };
        case "comment":
          return { type: "comment", body: a.body.trim() };
        case "notify":
          return { type: "notify", target: "assignee", message: a.message.trim() || undefined };
      }
    });
  }

  async function create() {
    if (!canAdd) return;
    const ok = await run(
      () =>
        api.createAutomation(boardId, {
          name: name.trim(),
          trigger: event === "schedule.tick" ? { event, every } : { event },
          conditions: buildConditions(),
          actions: buildActions(),
        }),
      "Could not create the rule"
    );
    if (ok) {
      setName("");
      setPredicates([]);
      setActions([{ type: "comment", body: "" }]);
      onCreated();
    }
  }

  return (
    <div className="grid gap-2 border-t pt-3">
      <Label htmlFor="rule-name">New automation</Label>
      <Input
        id="rule-name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Move urgent bugs to the top"
      />

      <label className="grid gap-1 text-xs text-muted-foreground">
        When
        <select
          aria-label="Trigger event"
          className="h-8 rounded-md border bg-transparent px-2 text-sm text-foreground"
          value={event}
          onChange={(e) => setEvent(e.target.value as TriggerEvent)}
        >
          {TRIGGER_EVENTS.map((ev) => (
            <option key={ev} value={ev}>
              {EVENT_LABELS[ev]}
            </option>
          ))}
        </select>
        {event === "schedule.tick" && (
          <select
            aria-label="Schedule interval"
            className="h-8 rounded-md border bg-transparent px-2 text-sm text-foreground"
            value={every}
            onChange={(e) => setEvery(e.target.value as ScheduleInterval)}
          >
            {SCHEDULE_INTERVALS.map((iv) => (
              <option key={iv} value={iv}>
                {iv}
              </option>
            ))}
          </select>
        )}
      </label>

      {/* If — the predicate tree (1.2 conditional branching) */}
      <div className="grid gap-1.5">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          If
          <select
            aria-label="Match combinator"
            className="h-7 rounded-md border bg-transparent px-1 text-xs text-foreground"
            value={combinator}
            onChange={(e) => setCombinator(e.target.value as "all" | "any")}
          >
            <option value="all">all of</option>
            <option value="any">any of</option>
          </select>
          <span>(leave empty to always run)</span>
        </div>
        {predicates.map((p, i) => {
          const unary = UNARY_OPS.includes(p.op);
          return (
            <div key={i} className="flex items-center gap-1.5">
              <select
                aria-label={`Condition ${i + 1} field`}
                className="h-7 rounded-md border bg-transparent px-1 text-xs text-foreground"
                value={p.field}
                onChange={(e) => setPredicate(i, { field: e.target.value })}
              >
                {CONDITION_FIELDS.map((f) => (
                  <option key={f.field} value={f.field}>
                    {f.label}
                  </option>
                ))}
              </select>
              <select
                aria-label={`Condition ${i + 1} operator`}
                className="h-7 rounded-md border bg-transparent px-1 text-xs text-foreground"
                value={p.op}
                onChange={(e) => setPredicate(i, { op: e.target.value as Operator })}
              >
                {OPERATORS.map((op) => (
                  <option key={op} value={op}>
                    {op}
                  </option>
                ))}
              </select>
              {!unary && (
                <Input
                  aria-label={`Condition ${i + 1} value`}
                  value={p.value}
                  onChange={(e) => setPredicate(i, { value: e.target.value })}
                  placeholder="value"
                  className="h-7 text-xs"
                />
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-1.5 text-xs text-muted-foreground hover:text-destructive"
                onClick={() => setPredicates((prev) => prev.filter((_, idx) => idx !== i))}
              >
                ✕
              </Button>
            </div>
          );
        })}
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="h-7 w-fit px-2 text-xs"
          onClick={() =>
            setPredicates((prev) => [...prev, { field: "priority", op: "eq", value: "" }])
          }
        >
          Add condition
        </Button>
      </div>

      {/* Then — the ordered action list */}
      <p className="text-xs text-muted-foreground">Then</p>
      <ul className="grid gap-1.5">
        {actions.map((a, i) => (
          <li key={i} className="flex items-center gap-1.5">
            <select
              aria-label={`Action ${i + 1} type`}
              className="h-7 rounded-md border bg-transparent px-1 text-xs text-foreground"
              value={a.type}
              onChange={(e) => {
                const t = e.target.value as ActionDraft["type"];
                setAction(
                  i,
                  t === "move"
                    ? { type: "move", columnId: String(columns[0]?.id ?? "") }
                    : t === "set_field"
                      ? { type: "set_field", field: "priority", value: "" }
                      : t === "add_label"
                        ? { type: "add_label", labelId: String(labels[0]?.id ?? "") }
                        : t === "notify"
                          ? { type: "notify", message: "" }
                          : { type: "comment", body: "" }
                );
              }}
            >
              <option value="move">move</option>
              <option value="set_field">set field</option>
              <option value="add_label">add label</option>
              <option value="comment">comment</option>
              <option value="notify">notify assignee</option>
            </select>

            {a.type === "move" && (
              <select
                aria-label={`Action ${i + 1} column`}
                className="h-7 rounded-md border bg-transparent px-1 text-xs text-foreground"
                value={a.columnId}
                onChange={(e) => setAction(i, { type: "move", columnId: e.target.value })}
              >
                {columns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            )}
            {a.type === "set_field" && (
              <>
                <select
                  aria-label={`Action ${i + 1} field`}
                  className="h-7 rounded-md border bg-transparent px-1 text-xs text-foreground"
                  value={a.field}
                  onChange={(e) =>
                    setAction(i, { type: "set_field", field: e.target.value as SettableField, value: a.value })
                  }
                >
                  {SETTABLE_FIELDS.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
                <Input
                  aria-label={`Action ${i + 1} value`}
                  value={a.value}
                  onChange={(e) => setAction(i, { type: "set_field", field: a.field, value: e.target.value })}
                  placeholder="value"
                  className="h-7 text-xs"
                />
              </>
            )}
            {a.type === "add_label" && (
              <select
                aria-label={`Action ${i + 1} label`}
                className="h-7 rounded-md border bg-transparent px-1 text-xs text-foreground"
                value={a.labelId}
                onChange={(e) => setAction(i, { type: "add_label", labelId: e.target.value })}
              >
                {labels.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            )}
            {a.type === "comment" && (
              <Input
                aria-label={`Action ${i + 1} body`}
                value={a.body}
                onChange={(e) => setAction(i, { type: "comment", body: e.target.value })}
                placeholder="Comment text"
                className="h-7 text-xs"
              />
            )}
            {a.type === "notify" && (
              <Input
                aria-label={`Action ${i + 1} message`}
                value={a.message}
                onChange={(e) => setAction(i, { type: "notify", message: e.target.value })}
                placeholder="Message (optional) — pings the assignee"
                className="h-7 text-xs"
              />
            )}

            {actions.length > 1 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-1.5 text-xs text-muted-foreground hover:text-destructive"
                onClick={() => setActions((prev) => prev.filter((_, idx) => idx !== i))}
              >
                ✕
              </Button>
            )}
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => setActions((prev) => [...prev, { type: "comment", body: "" }])}
        >
          Add action
        </Button>
        <Button
          type="button"
          size="sm"
          className="ml-auto"
          disabled={busy || !canAdd}
          onClick={create}
        >
          Add automation
        </Button>
      </div>
    </div>
  );
}
