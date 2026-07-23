"use client";

import { useCallback, useEffect, useState } from "react";
import { BarChart3, Loader2, Plus, Trash2 } from "lucide-react";

import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";

import {
  createReport,
  deleteReport,
  fetchReports,
  runReport,
  updateReport,
  type ReportRun,
} from "../client/api";
import { GROUP_BYS_BY_SOURCE, METRICS_BY_SOURCE } from "../lib/report";
import { ReportChart } from "./report-chart";
import {
  type CreateReportInput,
  type Report,
  type ReportGroupBy,
  type ReportMetric,
  type ReportSource,
  type ReportViz,
  type ReportVisibility,
} from "../types";
import { EMPTY_FILTER } from "@/features/board/lib/filter";

const SOURCE_LABELS: Record<ReportSource, string> = {
  tasks: "Tasks",
  time: "Time logged",
  flow: "Flow (cycle time)",
  financial: "Financial (spend)",
};

const METRIC_LABELS: Record<ReportMetric, string> = {
  count: "Task count",
  "sum:estimate": "Total estimate",
  "sum:minutes": "Total time",
  "avg:cycle": "Avg cycle time",
  "sum:spend": "Total spend",
};

const GROUP_LABELS: Record<ReportGroupBy, string> = {
  none: "No grouping (total)",
  status: "Status",
  assignee: "Assignee",
  priority: "Priority",
  label: "Label",
  board: "Board",
  user: "Member",
  day: "Day",
};

interface Draft {
  name: string;
  source: ReportSource;
  boardId: number | null;
  metric: ReportMetric;
  groupBy: ReportGroupBy;
  viz: ReportViz;
  visibility: ReportVisibility;
}

function draftFrom(report: Report): Draft {
  return {
    name: report.name,
    source: report.source,
    boardId: report.boardId,
    metric: report.metric,
    groupBy: report.groupBy,
    viz: report.viz,
    visibility: report.visibility,
  };
}

const NEW_DRAFT: Draft = {
  name: "",
  source: "tasks",
  boardId: null,
  metric: "count",
  groupBy: "status",
  viz: "bar",
  visibility: "private",
};

/**
 * The custom & financial report builder (5.1 + 5.2). A workspace panel: pick a
 * source, scope, grouping, metric and viz; save it; and see it rendered by the
 * shared chart. Metric/grouping options are derived from the same maps the API
 * validates against, so the form can only compose legal reports.
 */
export function ReportsPanel({
  workspaceId,
  boards,
}: {
  workspaceId: string;
  boards: { id: number; name: string }[];
}) {
  const [reports, setReports] = useState<Report[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [draft, setDraft] = useState<Draft>(NEW_DRAFT);
  const [run, setRun] = useState<ReportRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchReports(workspaceId).then(setReports).catch((e) => setError(String(e.message ?? e)));
  }, [workspaceId]);

  const selected = reports.find((r) => r.id === selectedId) ?? null;

  const select = useCallback(async (report: Report) => {
    setSelectedId(report.id);
    setDraft(draftFrom(report));
    setRun(null);
    setError(null);
    setBusy(true);
    try {
      setRun(await runReport(report.id));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }, []);

  function startNew() {
    setSelectedId(null);
    setDraft(NEW_DRAFT);
    setRun(null);
    setError(null);
  }

  // Keep metric/group_by legal whenever the source changes.
  function setSource(source: ReportSource) {
    const metrics = METRICS_BY_SOURCE[source];
    const groups = GROUP_BYS_BY_SOURCE[source];
    setDraft((d) => ({
      ...d,
      source,
      metric: metrics.includes(d.metric) ? d.metric : metrics[0],
      groupBy: groups.includes(d.groupBy) ? d.groupBy : groups[0],
    }));
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const input: CreateReportInput = {
        name: draft.name.trim(),
        source: draft.source,
        boardId: draft.boardId,
        metric: draft.metric,
        groupBy: draft.groupBy,
        viz: draft.viz,
        visibility: draft.visibility,
        filter: EMPTY_FILTER,
      };
      const saved =
        selected && selected.canManage
          ? await updateReport(selected.id, input)
          : await createReport(workspaceId, input);
      setReports((prev) => {
        const rest = prev.filter((r) => r.id !== saved.id);
        return [saved, ...rest];
      });
      await select(saved);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(report: Report) {
    setBusy(true);
    setError(null);
    try {
      await deleteReport(report.id);
      setReports((prev) => prev.filter((r) => r.id !== report.id));
      if (selectedId === report.id) startNew();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  const metrics = METRICS_BY_SOURCE[draft.source];
  const groups = GROUP_BYS_BY_SOURCE[draft.source];
  const canSave = draft.name.trim() !== "" && (!selected || selected.canManage);

  return (
    <div className="grid gap-4 md:grid-cols-[220px_1fr]">
      <aside className="flex flex-col gap-1">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Reports</h2>
          <Button size="sm" variant="ghost" onClick={startNew}>
            <Plus className="size-4" />
          </Button>
        </div>
        {reports.length === 0 && (
          <p className="text-xs text-muted-foreground">No reports yet.</p>
        )}
        {reports.map((r) => (
          <button
            key={r.id}
            onClick={() => select(r)}
            className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted ${
              selectedId === r.id ? "bg-muted font-medium" : ""
            }`}
          >
            <BarChart3 className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate">{r.name}</span>
            {r.visibility === "shared" && (
              <span className="ml-auto text-[10px] uppercase text-muted-foreground">shared</span>
            )}
          </button>
        ))}
      </aside>

      <section className="grid gap-4">
        <div className="grid gap-3 rounded-lg border p-4">
          <div className="flex items-center gap-2">
            <Input
              value={draft.name}
              placeholder="Report name"
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              className="max-w-xs"
            />
            {selected?.canManage && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => remove(selected)}
                aria-label="Delete report"
              >
                <Trash2 className="size-4" />
              </Button>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Source">
              <Select value={draft.source} onChange={(v) => setSource(v as ReportSource)}>
                {Object.entries(SOURCE_LABELS).map(([v, label]) => (
                  <option key={v} value={v}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Scope">
              <Select
                value={draft.boardId === null ? "" : String(draft.boardId)}
                onChange={(v) =>
                  setDraft((d) => ({ ...d, boardId: v === "" ? null : Number(v) }))
                }
              >
                <option value="">All boards (portfolio)</option>
                {boards.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Metric">
              <Select
                value={draft.metric}
                onChange={(v) => setDraft((d) => ({ ...d, metric: v as ReportMetric }))}
              >
                {metrics.map((m) => (
                  <option key={m} value={m}>
                    {METRIC_LABELS[m]}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Group by">
              <Select
                value={draft.groupBy}
                onChange={(v) => setDraft((d) => ({ ...d, groupBy: v as ReportGroupBy }))}
              >
                {groups.map((g) => (
                  <option key={g} value={g}>
                    {GROUP_LABELS[g]}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Chart">
              <Select
                value={draft.viz}
                onChange={(v) => setDraft((d) => ({ ...d, viz: v as ReportViz }))}
              >
                <option value="bar">Bar</option>
                <option value="line">Line</option>
                <option value="table">Table</option>
              </Select>
            </Field>

            <Field label="Visibility">
              <Select
                value={draft.visibility}
                onChange={(v) =>
                  setDraft((d) => ({ ...d, visibility: v as ReportVisibility }))
                }
              >
                <option value="private">Private (only me)</option>
                <option value="shared">Shared (workspace)</option>
              </Select>
            </Field>
          </div>

          <div className="flex items-center gap-3">
            <Button onClick={save} disabled={!canSave || busy}>
              {busy && <Loader2 className="mr-2 size-4 animate-spin" />}
              {selected ? "Save changes" : "Create report"}
            </Button>
            {selected && !selected.canManage && (
              <span className="text-xs text-muted-foreground">
                Shared report — admin required to edit.
              </span>
            )}
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <div className="rounded-lg border p-4">
          {busy && !run && (
            <p className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Running…
            </p>
          )}
          {run ? (
            <ReportChart result={run.result} currency={run.currency} />
          ) : (
            !busy && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Select or save a report to see its result.
              </p>
            )
          )}
        </div>
      </section>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function Select({
  value,
  onChange,
  children,
}: {
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-9 rounded-md border bg-background px-2 text-sm"
    >
      {children}
    </select>
  );
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
