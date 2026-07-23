/**
 * Reports data layer (5.1 + 5.2). SQL + authz live here; the aggregation is the
 * pure `runReport` in lib/. `gatherFacts` is the source-specific half: it reads
 * the existing read model (tasks, the time ledger, the flow replay, or the
 * financial roll-up), applies the reused saved-view filter, and emits flat
 * `ReportFact`s already tagged with their bucket label. Scope is one board or —
 * when `board_id` is null — every board in the workspace (the portfolio).
 */
import { asPrincipal } from "@/features/auth/server/principal";
import type { Principal } from "@/features/auth/server/principal";
import { getBoardAnalytics } from "@/features/board/server/analytics";
import { actorKey, EMPTY_FILTER, taskMatchesFilter } from "@/features/board/lib/filter";
import type { BoardFilter } from "@/features/board/lib/filter";
import { costOf } from "@/features/budget/lib/budget";
import { taskColumns } from "@/features/tasks/server/task-row";
import type { Task } from "@/features/tasks/types";
import {
  AuthzError,
  requireWorkspaceRole,
  ROLE_RANK,
} from "@/features/workspaces/server/authz";
import type { WorkspaceRole } from "@/features/workspaces/types";
import { query, queryOne } from "@/shared/db/client";

import type {
  CreateReportInput,
  Report,
  ReportFact,
  ReportResult,
  UpdateReportInput,
} from "../types";
import { isGroupByCompatible, isMetricCompatible, runReport } from "../lib/report";

const REPORT_COLUMNS = `id,
  workspace_id AS "workspaceId",
  board_id AS "boardId",
  created_by AS "createdBy",
  name, source, filter,
  group_by AS "groupBy",
  metric, viz, visibility,
  created_at AS "createdAt",
  updated_at AS "updatedAt"`;

type ReportRow = Omit<Report, "canManage">;

/** The acting identity's id — a user id for a human, the agent id for an agent. */
function callerId(actor: string | Principal): string {
  const p = asPrincipal(actor);
  return p.kind === "human" ? p.userId : p.agentId;
}

function canManage(report: ReportRow, role: WorkspaceRole, caller: string): boolean {
  return report.visibility === "private"
    ? report.createdBy === caller
    : ROLE_RANK[role] >= ROLE_RANK.admin;
}

function withCanManage(report: ReportRow, role: WorkspaceRole, caller: string): Report {
  return { ...report, canManage: canManage(report, role, caller) };
}

/** Shared reports plus the caller's own private ones, newest first. */
export async function listReports(
  actor: string | Principal,
  workspaceId: string
): Promise<Report[]> {
  const role = await requireWorkspaceRole(actor, workspaceId, "viewer");
  const caller = callerId(actor);
  const rows = await query<ReportRow>(
    `SELECT ${REPORT_COLUMNS} FROM report
      WHERE workspace_id = $1 AND (visibility = 'shared' OR created_by = $2)
      ORDER BY created_at DESC, id DESC`,
    [workspaceId, caller]
  );
  return rows.map((r) => withCanManage(r, role, caller));
}

/** Fetch a single report the caller may see (private ⇒ owner-only), or 404. */
async function requireVisibleReport(
  actor: string | Principal,
  reportId: number
): Promise<{ report: ReportRow; role: WorkspaceRole; caller: string }> {
  const report = await queryOne<ReportRow>(
    `SELECT ${REPORT_COLUMNS} FROM report WHERE id = $1`,
    [reportId]
  );
  if (!report) throw new AuthzError("not_found", "Report not found");
  const role = await requireWorkspaceRole(actor, report.workspaceId, "viewer");
  const caller = callerId(actor);
  if (report.visibility === "private" && report.createdBy !== caller) {
    throw new AuthzError("not_found", "Report not found");
  }
  return { report, role, caller };
}

/** The workspace role authoring a report at this visibility demands. */
function authoringRole(visibility: "private" | "shared"): WorkspaceRole {
  return visibility === "shared" ? "admin" : "member";
}

async function assertBoardInWorkspace(boardId: number, workspaceId: string): Promise<void> {
  const row = await queryOne<{ id: number }>(
    `SELECT id FROM board WHERE id = $1 AND workspace_id = $2`,
    [boardId, workspaceId]
  );
  if (!row) throw new AuthzError("not_found", "Board not found in this workspace");
}

export async function createReport(
  userId: string,
  workspaceId: string,
  input: CreateReportInput
): Promise<Report> {
  const visibility = input.visibility ?? "private";
  const role = await requireWorkspaceRole(userId, workspaceId, authoringRole(visibility));
  if (input.boardId != null) await assertBoardInWorkspace(input.boardId, workspaceId);

  let rows: ReportRow[];
  try {
    rows = await query<ReportRow>(
      `INSERT INTO report
         (workspace_id, board_id, created_by, name, source, filter, group_by, metric, viz, visibility)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10)
       RETURNING ${REPORT_COLUMNS}`,
      [
        workspaceId,
        input.boardId ?? null,
        userId,
        input.name.trim(),
        input.source,
        JSON.stringify(input.filter ?? EMPTY_FILTER),
        input.groupBy ?? "none",
        input.metric,
        input.viz ?? "table",
        visibility,
      ]
    );
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      throw new AuthzError("conflict", "A report with that name already exists");
    }
    throw error;
  }
  return withCanManage(rows[0], role, userId);
}

export async function updateReport(
  userId: string,
  reportId: number,
  input: UpdateReportInput
): Promise<Report> {
  const { report } = await requireVisibleReport(userId, reportId);
  // Manage rights are judged at the report's CURRENT visibility, and — when the
  // caller is re-sharing it — also at the target visibility, so a member cannot
  // promote their private report to a shared one.
  const role = await requireWorkspaceRole(userId, report.workspaceId, authoringRole(report.visibility));
  if (input.visibility && input.visibility !== report.visibility) {
    await requireWorkspaceRole(userId, report.workspaceId, authoringRole(input.visibility));
  }
  if (!canManage(report, role, userId)) {
    throw new AuthzError("forbidden", "You cannot edit this report");
  }
  const nextBoardId = "boardId" in input ? input.boardId ?? null : report.boardId;
  if (nextBoardId != null) await assertBoardInWorkspace(nextBoardId, report.workspaceId);

  // The merged source/metric/group_by triad must stay coherent — reject a
  // partial update that would leave, say, source=time with metric=avg:cycle.
  const source = input.source ?? report.source;
  const metric = input.metric ?? report.metric;
  const groupBy = input.groupBy ?? report.groupBy;
  if (!isMetricCompatible(source, metric)) {
    throw new AuthzError("conflict", `metric "${metric}" is not valid for source "${source}"`);
  }
  if (!isGroupByCompatible(source, groupBy)) {
    throw new AuthzError("conflict", `group_by "${groupBy}" is not valid for source "${source}"`);
  }

  let rows: ReportRow[];
  try {
    rows = await query<ReportRow>(
      `UPDATE report SET
         name       = COALESCE($2, name),
         board_id   = CASE WHEN $3::boolean THEN $4 ELSE board_id END,
         source     = COALESCE($5, source),
         filter     = COALESCE($6::jsonb, filter),
         group_by   = COALESCE($7, group_by),
         metric     = COALESCE($8, metric),
         viz        = COALESCE($9, viz),
         visibility = COALESCE($10, visibility),
         updated_at = now()
       WHERE id = $1
       RETURNING ${REPORT_COLUMNS}`,
      [
        reportId,
        input.name?.trim() ?? null,
        "boardId" in input,
        input.boardId ?? null,
        input.source ?? null,
        input.filter ? JSON.stringify(input.filter) : null,
        input.groupBy ?? null,
        input.metric ?? null,
        input.viz ?? null,
        input.visibility ?? null,
      ]
    );
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      throw new AuthzError("conflict", "A report with that name already exists");
    }
    throw error;
  }
  const finalRole = await requireWorkspaceRole(userId, report.workspaceId, "viewer");
  return withCanManage(rows[0], finalRole, userId);
}

export async function deleteReport(userId: string, reportId: number): Promise<boolean> {
  const { report, role } = await requireVisibleReport(userId, reportId);
  if (!canManage(report, role, userId)) {
    throw new AuthzError("forbidden", "You cannot delete this report");
  }
  const rows = await query<{ id: number }>(`DELETE FROM report WHERE id = $1 RETURNING id`, [
    reportId,
  ]);
  return rows.length > 0;
}

/** Run a stored report: gather its facts, fold them, and shape the result. */
export async function runReportById(
  actor: string | Principal,
  reportId: number
): Promise<{ report: Report; result: ReportResult; currency: string | null }> {
  const { report, role, caller } = await requireVisibleReport(actor, reportId);
  const { facts, currency } = await gatherFacts(actor, report);
  const result: ReportResult = {
    ...runReport(report, facts),
    viz: report.viz,
  };
  return { report: withCanManage(report, role, caller), result, currency };
}

// ── Fact gathering ─────────────────────────────────────────────────────────

type TaskFactRow = Task & {
  status: string;
  boardId: number;
  boardName: string;
  assigneeName: string | null;
};

/** Top-level tasks in the report's scope, already filter-matched. */
async function scopedTasks(report: ReportRow): Promise<TaskFactRow[]> {
  const params: (string | number)[] = [report.workspaceId];
  let boardClause = "";
  if (report.boardId != null) {
    params.push(report.boardId);
    boardClause = ` AND b.id = $2`;
  }
  const rows = await query<TaskFactRow>(
    `SELECT ${taskColumns("t")},
            bc.title AS "status",
            b.id AS "boardId",
            b.name AS "boardName",
            COALESCE(u.name, ag.name) AS "assigneeName"
       FROM task t
       JOIN board_column bc ON bc.id = t.column_id
       JOIN board b ON b.id = bc.board_id
       LEFT JOIN "user" u ON u.id = t.assignee_id
       LEFT JOIN agent ag ON ag.id = t.agent_id
      WHERE b.workspace_id = $1 AND t.parent_id IS NULL${boardClause}`,
    params
  );
  const filter = report.filter as BoardFilter;
  return rows.filter((row) => taskMatchesFilter(row, filter));
}

function fact(group: string, measures: Partial<ReportFact> = {}): ReportFact {
  return { group, estimate: 0, minutes: 0, spend: 0, cycleDays: null, ...measures };
}

async function gatherFacts(
  actor: string | Principal,
  report: ReportRow
): Promise<{ facts: ReportFact[]; currency: string | null }> {
  switch (report.source) {
    case "tasks":
      return { facts: await taskFacts(report), currency: null };
    case "time":
      return { facts: await timeFacts(report), currency: null };
    case "financial":
      return timeFactsFinancial(report);
    case "flow":
      return { facts: await flowFacts(actor, report), currency: null };
  }
}

async function taskFacts(report: ReportRow): Promise<ReportFact[]> {
  const tasks = await scopedTasks(report);
  const facts: ReportFact[] = [];
  for (const t of tasks) {
    const measures = { estimate: t.estimate ?? 0 };
    if (report.groupBy === "label") {
      // Multi-valued: a task lands in a bucket per label it wears (none ⇒ "No label").
      if (t.labels.length === 0) facts.push(fact("No label", measures));
      else for (const l of t.labels) facts.push(fact(l.name, measures));
    } else {
      facts.push(fact(taskGroup(report, t), measures));
    }
  }
  return facts;
}

function taskGroup(report: ReportRow, t: TaskFactRow): string {
  switch (report.groupBy) {
    case "status":
      return t.status;
    case "assignee":
      return t.assigneeName ?? (t.assignee ? actorKey(t.assignee) : "Unassigned");
    case "priority":
      return t.priority;
    case "board":
      return t.boardName;
    default:
      return "";
  }
}

interface TimeRow {
  minutes: number;
  spentOn: string;
  userName: string | null;
  boardName: string;
  hourlyRate: number;
  currency: string;
}

async function scopedTimeRows(report: ReportRow): Promise<TimeRow[]> {
  const tasks = await scopedTasks(report);
  const taskIds = tasks.map((t) => t.id);
  if (taskIds.length === 0) return [];
  return query<TimeRow>(
    `SELECT te.minutes,
            te.spent_on AS "spentOn",
            COALESCE(u.name, te.user_id) AS "userName",
            b.name AS "boardName",
            b.hourly_rate AS "hourlyRate",
            b.currency AS "currency"
       FROM time_entry te
       JOIN task t ON t.id = te.task_id
       JOIN board_column bc ON bc.id = t.column_id
       JOIN board b ON b.id = bc.board_id
       LEFT JOIN "user" u ON u.id = te.user_id
      WHERE te.task_id = ANY($1::int[])`,
    [taskIds]
  );
}

function timeGroup(report: ReportRow, row: TimeRow): string {
  switch (report.groupBy) {
    case "user":
      return row.userName ?? "Unknown";
    case "day":
      return row.spentOn;
    case "board":
      return row.boardName;
    default:
      return "";
  }
}

async function timeFacts(report: ReportRow): Promise<ReportFact[]> {
  const rows = await scopedTimeRows(report);
  return rows.map((row) => fact(timeGroup(report, row), { minutes: row.minutes }));
}

async function timeFactsFinancial(
  report: ReportRow
): Promise<{ facts: ReportFact[]; currency: string | null }> {
  const rows = await scopedTimeRows(report);
  const facts = rows.map((row) =>
    fact(timeGroup(report, row), {
      minutes: row.minutes,
      spend: costOf(row.minutes, row.hourlyRate),
    })
  );
  // A single currency across scope is meaningful to display; a mix is not.
  const currencies = new Set(rows.map((r) => r.currency));
  const currency = currencies.size === 1 ? [...currencies][0] : null;
  return { facts, currency };
}

/**
 * One fact per board in scope carrying that board's average cycle time (5.1's
 * flow source). Cycle is a board-level replay (analytics), so the task-level
 * filter does not apply here; `avg:cycle` over the facts is the mean of the
 * per-board averages when grouping is "none".
 */
async function flowFacts(actor: string | Principal, report: ReportRow): Promise<ReportFact[]> {
  const params: (string | number)[] = [report.workspaceId];
  let boardClause = "";
  if (report.boardId != null) {
    params.push(report.boardId);
    boardClause = ` AND id = $2`;
  }
  const boards = await query<{ id: number; name: string }>(
    `SELECT id, name FROM board WHERE workspace_id = $1${boardClause} ORDER BY name, id`,
    params
  );
  const facts: ReportFact[] = [];
  for (const board of boards) {
    const analytics = await getBoardAnalytics(actor, board.id);
    const avgDays = analytics.cycleTime?.avgDays ?? null;
    facts.push(fact(report.groupBy === "board" ? board.name : "", { cycleDays: avgDays }));
  }
  return facts;
}
