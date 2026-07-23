import type {
  CreateReportInput,
  Report,
  ReportResult,
  UpdateReportInput,
} from "../types";

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(
      (body as { error?: string } | null)?.error ?? `Request failed (${res.status})`
    );
  }
  return res.json() as Promise<T>;
}

/** The computed result the run endpoint returns alongside the definition. */
export interface ReportRun {
  report: Report;
  result: ReportResult;
  currency: string | null;
}

export async function fetchReports(workspaceId: string): Promise<Report[]> {
  const res = await fetch(`/api/workspaces/${workspaceId}/reports`, { cache: "no-store" });
  return jsonOrThrow<Report[]>(res);
}

export function createReport(
  workspaceId: string,
  input: CreateReportInput
): Promise<Report> {
  return fetch(`/api/workspaces/${workspaceId}/reports`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((res) => jsonOrThrow<Report>(res));
}

export function updateReport(id: number, input: UpdateReportInput): Promise<Report> {
  return fetch(`/api/reports/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((res) => jsonOrThrow<Report>(res));
}

export async function deleteReport(id: number): Promise<void> {
  const res = await fetch(`/api/reports/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Delete failed (${res.status})`);
}

export function runReport(id: number): Promise<ReportRun> {
  return fetch(`/api/reports/${id}/run`, { cache: "no-store" }).then((res) =>
    jsonOrThrow<ReportRun>(res)
  );
}
