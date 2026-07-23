import { getPrincipalFromRequest } from "@/features/auth/server/agent-auth";
import { getSessionFromRequest, unauthorized } from "@/features/auth/server/session";
import { isTaskPriority } from "@/features/tasks/types";
import { authzErrorResponse } from "@/features/workspaces/server/authz";

import {
  createReport,
  deleteReport,
  listReports,
  runReportById,
  updateReport,
} from "./repository";
import { isGroupByCompatible, isMetricCompatible } from "../lib/report";
import type { BoardFilter } from "@/features/board/lib/filter";
import {
  REPORT_GROUP_BYS,
  REPORT_METRICS,
  REPORT_NAME_MAX,
  REPORT_SOURCES,
  REPORT_VISIBILITY,
  REPORT_VIZ,
  type CreateReportInput,
  type ReportGroupBy,
  type ReportMetric,
  type ReportSource,
  type ReportViz,
  type ReportVisibility,
  type UpdateReportInput,
} from "../types";

// Reads take a principal (an agent may read a workspace's shared reports);
// authoring takes a human session — the same split releases draws.

function badRequest(message: string) {
  return Response.json({ error: message }, { status: 400 });
}
function notFound() {
  return Response.json({ error: "Report not found" }, { status: 404 });
}

function oneOf<T extends string>(allowed: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

/** Validate the reused saved-view filter shape (the API polices it; DB only says "object"). */
function readFilter(value: unknown): BoardFilter | null {
  const f = (value ?? {}) as Record<string, unknown>;
  const text = f.text === undefined ? "" : f.text;
  const priorities = f.priorities === undefined ? [] : f.priorities;
  const labelIds = f.labelIds === undefined ? [] : f.labelIds;
  const assignees = f.assignees === undefined ? [] : f.assignees;
  if (typeof text !== "string") return null;
  if (!Array.isArray(priorities) || !priorities.every(isTaskPriority)) return null;
  if (!Array.isArray(labelIds) || !labelIds.every((n) => Number.isInteger(n))) return null;
  if (!Array.isArray(assignees) || !assignees.every((a) => typeof a === "string")) return null;
  return { text, priorities, labelIds: labelIds as number[], assignees: assignees as string[] };
}

/** The shared rule: the source must be able to produce this metric & grouping. */
function compatError(
  source: ReportSource,
  metric: ReportMetric,
  groupBy: ReportGroupBy
): string | null {
  if (!isMetricCompatible(source, metric)) {
    return `metric "${metric}" is not valid for source "${source}"`;
  }
  if (!isGroupByCompatible(source, groupBy)) {
    return `group_by "${groupBy}" is not valid for source "${source}"`;
  }
  return null;
}

export async function handleListReports(request: Request, workspaceId: string) {
  const principal = await getPrincipalFromRequest(request);
  if (!principal) return unauthorized();
  try {
    return Response.json(await listReports(principal, workspaceId));
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleRunReport(request: Request, id: string) {
  const principal = await getPrincipalFromRequest(request);
  if (!principal) return unauthorized();
  const reportId = Number(id);
  if (!Number.isInteger(reportId)) return badRequest("Invalid report id");
  try {
    return Response.json(await runReportById(principal, reportId));
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleCreateReport(request: Request, workspaceId: string) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();
  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object") return badRequest("Invalid JSON body");
  const p = payload as Record<string, unknown>;

  const name = p.name;
  if (typeof name !== "string" || name.trim() === "") return badRequest("name is required");
  if (name.trim().length > REPORT_NAME_MAX) {
    return badRequest(`name must be ${REPORT_NAME_MAX} characters or fewer`);
  }
  if (!oneOf(REPORT_SOURCES, p.source)) return badRequest("invalid source");
  if (!oneOf(REPORT_METRICS, p.metric)) return badRequest("invalid metric");
  const groupBy: ReportGroupBy = p.groupBy === undefined ? "none" : (p.groupBy as ReportGroupBy);
  if (!oneOf(REPORT_GROUP_BYS, groupBy)) return badRequest("invalid group_by");
  const viz: ReportViz = p.viz === undefined ? "table" : (p.viz as ReportViz);
  if (!oneOf(REPORT_VIZ, viz)) return badRequest("invalid viz");
  const visibility: ReportVisibility =
    p.visibility === undefined ? "private" : (p.visibility as ReportVisibility);
  if (!oneOf(REPORT_VISIBILITY, visibility)) return badRequest("invalid visibility");
  if (p.boardId !== undefined && p.boardId !== null && !Number.isInteger(p.boardId)) {
    return badRequest("boardId must be an integer or null");
  }
  const filter = readFilter(p.filter);
  if (!filter) return badRequest("invalid filter");

  const mismatch = compatError(p.source, p.metric, groupBy);
  if (mismatch) return badRequest(mismatch);

  const input: CreateReportInput = {
    name: name.trim(),
    boardId: (p.boardId as number | null | undefined) ?? null,
    source: p.source,
    filter,
    groupBy,
    metric: p.metric,
    viz,
    visibility,
  };
  try {
    return Response.json(await createReport(session.user.id, workspaceId, input), { status: 201 });
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleUpdateReport(request: Request, id: string) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();
  const reportId = Number(id);
  if (!Number.isInteger(reportId)) return badRequest("Invalid report id");
  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object") return badRequest("Invalid JSON body");
  const p = payload as Record<string, unknown>;

  const input: UpdateReportInput = {};
  if (p.name !== undefined) {
    if (typeof p.name !== "string" || p.name.trim() === "") return badRequest("name is required");
    if (p.name.trim().length > REPORT_NAME_MAX) {
      return badRequest(`name must be ${REPORT_NAME_MAX} characters or fewer`);
    }
    input.name = p.name.trim();
  }
  if ("boardId" in p) {
    if (p.boardId !== null && !Number.isInteger(p.boardId)) {
      return badRequest("boardId must be an integer or null");
    }
    input.boardId = (p.boardId as number | null) ?? null;
  }
  if (p.source !== undefined) {
    if (!oneOf(REPORT_SOURCES, p.source)) return badRequest("invalid source");
    input.source = p.source;
  }
  if (p.metric !== undefined) {
    if (!oneOf(REPORT_METRICS, p.metric)) return badRequest("invalid metric");
    input.metric = p.metric;
  }
  if (p.groupBy !== undefined) {
    if (!oneOf(REPORT_GROUP_BYS, p.groupBy)) return badRequest("invalid group_by");
    input.groupBy = p.groupBy;
  }
  if (p.viz !== undefined) {
    if (!oneOf(REPORT_VIZ, p.viz)) return badRequest("invalid viz");
    input.viz = p.viz;
  }
  if (p.visibility !== undefined) {
    if (!oneOf(REPORT_VISIBILITY, p.visibility)) return badRequest("invalid visibility");
    input.visibility = p.visibility;
  }
  if (p.filter !== undefined) {
    const filter = readFilter(p.filter);
    if (!filter) return badRequest("invalid filter");
    input.filter = filter;
  }

  try {
    return Response.json(await updateReport(session.user.id, reportId, input));
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleDeleteReport(request: Request, id: string) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();
  const reportId = Number(id);
  if (!Number.isInteger(reportId)) return badRequest("Invalid report id");
  try {
    const ok = await deleteReport(session.user.id, reportId);
    return ok ? new Response(null, { status: 204 }) : notFound();
  } catch (error) {
    return authzErrorResponse(error);
  }
}
