import { getPrincipalFromRequest } from "@/features/auth/server/agent-auth";
import { unauthorized } from "@/features/auth/server/session";
import { listAssignees } from "@/features/agents/server/roster";
import { taskColumns } from "@/features/tasks/server/repository";
import type { Task } from "@/features/tasks/types";
import { authzErrorResponse } from "@/features/workspaces/server/authz";
import { query } from "@/shared/db/client";
import { getBoard } from "./repository";

/**
 * A board's tasks as a file — CSV for the spreadsheet, JSON for everything
 * else. "viewer": an export is a read, exactly the rank getBoard already asks,
 * and the payload is what the board renders. Names come from listAssignees —
 * the email-free roster — so an export never carries an address the board
 * itself would not show.
 *
 * Names are resolved server-side, unlike the board (which looks ids up against
 * rosters the client holds anyway), because a file has no roster to consult:
 * an export that says "human:7f3a…" is not an export, it is a join the reader
 * now owes. Subtasks ride along under their parent's title — the board hides
 * them behind a count, but a file that silently dropped rows would under-count
 * every decomposed task, and BI tooling would repeat the lie forever.
 */

/** RFC-4180 quoting: any field may carry commas, quotes, or newlines. */
function csvField(value: string | number | null): string {
  if (value === null) return "";
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

interface ExportRow {
  id: number;
  title: string;
  description: string;
  type: string;
  status: string;
  priority: string;
  estimate: number | null;
  assignee: string | null;
  milestone: string | null;
  epic: string | null;
  sprint: string | null;
  dueDate: string | null;
  labels: string[];
  parentTask: string | null;
  createdAt: string;
}

const CSV_COLUMNS: [header: string, read: (r: ExportRow) => string | number | null][] = [
  ["id", (r) => r.id],
  ["title", (r) => r.title],
  ["description", (r) => r.description],
  ["type", (r) => r.type],
  ["status", (r) => r.status],
  ["priority", (r) => r.priority],
  ["estimate", (r) => r.estimate],
  ["assignee", (r) => r.assignee],
  ["milestone", (r) => r.milestone],
  ["epic", (r) => r.epic],
  ["sprint", (r) => r.sprint],
  ["due_date", (r) => r.dueDate],
  // One cell, "; "-joined: a CSV has no list type, and a second file of
  // task-label pairs would be normalization nobody asked a spreadsheet for.
  ["labels", (r) => r.labels.join("; ")],
  ["parent_task", (r) => r.parentTask],
  ["created_at", (r) => r.createdAt],
];

function toCsv(rows: ExportRow[]): string {
  const lines = [CSV_COLUMNS.map(([header]) => header).join(",")];
  for (const row of rows) {
    lines.push(CSV_COLUMNS.map(([, read]) => csvField(read(row))).join(","));
  }
  // CRLF is RFC-4180's line ending, and the one Excel is happiest with.
  return lines.join("\r\n") + "\r\n";
}

export async function handleExportBoard(request: Request, id: string) {
  const principal = await getPrincipalFromRequest(request);
  if (!principal) return unauthorized();

  const boardId = Number(id);
  if (!Number.isInteger(boardId))
    return Response.json({ error: "Invalid board id" }, { status: 400 });

  const format = new URL(request.url).searchParams.get("format") ?? "csv";
  if (format !== "csv" && format !== "json")
    return Response.json(
      { error: "format must be csv or json" },
      { status: 400 }
    );

  try {
    // getBoard carries the authz (viewer) and the column titles; the second
    // read below exists because getBoard's tasks are top-level only.
    const data = await getBoard(principal, boardId);
    if (!data)
      return Response.json({ error: "Board not found" }, { status: 404 });

    const allTasks = await query<Task>(
      `SELECT ${taskColumns("t")}
         FROM task t
         JOIN board_column bc ON bc.id = t.column_id
        WHERE bc.board_id = $1
        ORDER BY t.parent_id NULLS FIRST, t.column_id, t.position`,
      [boardId]
    );

    const { members, agents } = await listAssignees(
      principal,
      data.board.workspaceId
    );
    const memberName = new Map(members.map((m) => [m.userId, m.name]));
    const agentName = new Map(agents.map((a) => [a.id, a.name]));
    const columnTitle = new Map(data.columns.map((c) => [c.id, c.title]));
    const titleById = new Map(allTasks.map((t) => [t.id, t.title]));
    const milestoneName = new Map(data.milestones.map((m) => [m.id, m.name]));
    const epicName = new Map(data.epics.map((e) => [e.id, e.name]));
    const sprintName = new Map(data.sprints.map((s) => [s.id, s.name]));

    const rows: ExportRow[] = allTasks.map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      type: t.type,
      status: columnTitle.get(t.columnId) ?? String(t.columnId),
      priority: t.priority,
      estimate: t.estimate,
      assignee: t.assignee
        ? t.assignee.type === "human"
          ? (memberName.get(t.assignee.id) ?? t.assignee.id)
          : (agentName.get(t.assignee.id) ?? t.assignee.id)
        : null,
      milestone:
        t.milestoneId === null
          ? null
          : (milestoneName.get(t.milestoneId) ?? null),
      epic:
        t.epicId === null ? null : (epicName.get(t.epicId) ?? null),
      sprint:
        t.sprintId === null ? null : (sprintName.get(t.sprintId) ?? null),
      dueDate: t.dueDate,
      labels: t.labels.map((l) => l.name),
      parentTask: t.parentId ? (titleById.get(t.parentId) ?? null) : null,
      createdAt: t.createdAt,
    }));

    const filename = `board-${boardId}-export.${format}`;
    if (format === "json") {
      return new Response(JSON.stringify(rows, null, 2), {
        headers: {
          "content-type": "application/json",
          "content-disposition": `attachment; filename="${filename}"`,
        },
      });
    }
    return new Response(toCsv(rows), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    return authzErrorResponse(error);
  }
}
