"use client";

import { useEffect, useState } from "react";

import * as api from "@/features/workspaces/client/api";
import type { WorkspaceMembership } from "@/features/workspaces/types";
import type { AdminSummary } from "../types";

/**
 * What this workspace currently contains, as counts.
 *
 * Deliberately counts and not records: the sections beside it are where each
 * resource is managed, and a landing page that duplicated them would be a
 * second place for the same thing to be wrong. It answers "is this workspace
 * the size I think it is" — the question that sends you to the right section.
 */
export function WorkspaceOverviewPanel({
  workspace,
}: {
  workspace: WorkspaceMembership;
}) {
  const [summary, setSummary] = useState<AdminSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api
      .fetchAdminSummary(workspace.id)
      .then((next) => {
        if (!cancelled) setSummary(next);
      })
      .catch((e: unknown) => {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "Could not load the summary");
      });
    return () => {
      cancelled = true;
    };
  }, [workspace.id]);

  const counts: [string, number | undefined][] = [
    ["Members", summary?.members],
    ["Agents", summary?.agents],
    ["Boards", summary?.boards],
    ["Active webhooks", summary?.webhooks],
    ["Audit events", summary?.auditEvents],
  ];

  return (
    <div className="grid gap-3">
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {counts.map(([label, value]) => (
          <div key={label} className="rounded-lg border px-3 py-2">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="text-lg font-semibold tabular-nums">
              {value ?? "—"}
            </dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-muted-foreground">
        Managing {workspace.name}. Each section on the left is one thing this
        workspace is configured by.
      </p>
    </div>
  );
}
